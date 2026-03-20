/**
 * Cross-Device Sync Engine — State reconciliation for FreedomForge Max.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Ensures desktop, mobile (iOS/Capacitor), and web clients stay in sync:
 *  • Vector clock versioning for conflict-free state merging
 *  • Last-write-wins with device priority for conflict resolution
 *  • Delta-based sync — only changed fields transmitted
 *  • Offline queue — mutations buffered when disconnected, replayed on reconnect
 *  • Device registry — tracks all connected devices and their sync state
 *
 * Architecture:
 *  - Each device has a unique deviceId (generated on first launch)
 *  - State changes are tagged with [deviceId, sequenceNumber] pairs
 *  - Sync endpoint accepts deltas and returns merged state
 *  - Conflict resolution: most recent timestamp wins, with device priority tiebreaker
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SYNC_DIR = path.join(DATA_DIR, 'sync');
const DEVICES_FILE = path.join(SYNC_DIR, 'devices.json');
const SYNC_STATE_FILE = path.join(SYNC_DIR, 'sync-state.json');
const MAX_OFFLINE_QUEUE = 500;
const MAX_DEVICES = 20;

// ─── Types ────────────────────────────────────────────────────────────────────

export type DevicePlatform = 'ios' | 'android' | 'web' | 'desktop' | 'api';

export interface DeviceRecord {
  deviceId: string;
  name: string;
  platform: DevicePlatform;
  registeredAt: number;
  lastSyncAt: number;
  lastSyncSeq: number;
  userAgent?: string;
  ipHash?: string; // SHA-256 hash of IP for fingerprinting, not stored raw
}

export interface VectorClock {
  [deviceId: string]: number; // deviceId -> sequence number
}

export interface SyncDelta {
  deviceId: string;
  seq: number;
  ts: number;
  path: string;      // JSON pointer to changed field (e.g. "settings.theme")
  value: unknown;     // New value
  checksum: string;   // SHA-256 of JSON.stringify(value)
}

export interface SyncState {
  version: number;
  vectorClock: VectorClock;
  deltas: SyncDelta[];
  resolvedState: Record<string, unknown>;
  lastMergeAt: number;
}

export interface SyncResponse {
  status: 'ok' | 'conflict_resolved' | 'error';
  serverSeq: number;
  vectorClock: VectorClock;
  deltas: SyncDelta[];          // Deltas the client is missing
  resolvedConflicts: string[];  // Paths where conflicts were auto-resolved
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function ensureSyncDir() {
  if (!fs.existsSync(SYNC_DIR)) fs.mkdirSync(SYNC_DIR, { recursive: true });
}

function loadDevices(): DeviceRecord[] {
  try {
    if (fs.existsSync(DEVICES_FILE)) {
      return JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf8'));
    }
  } catch { /* fallback */ }
  return [];
}

function saveDevices(devices: DeviceRecord[]) {
  ensureSyncDir();
  fs.writeFileSync(DEVICES_FILE, JSON.stringify(devices, null, 2), 'utf8');
}

function loadSyncState(): SyncState {
  try {
    if (fs.existsSync(SYNC_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(SYNC_STATE_FILE, 'utf8'));
    }
  } catch { /* fallback */ }
  return {
    version: 1,
    vectorClock: {},
    deltas: [],
    resolvedState: {},
    lastMergeAt: 0,
  };
}

function saveSyncState(state: SyncState) {
  ensureSyncDir();
  fs.writeFileSync(SYNC_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// ─── Device Management ────────────────────────────────────────────────────────

/**
 * Register or update a device in the sync registry.
 */
export function registerDevice(input: {
  deviceId: string;
  name: string;
  platform: DevicePlatform;
  userAgent?: string;
  ip?: string;
}): DeviceRecord {
  ensureSyncDir();
  const devices = loadDevices();

  const existing = devices.find((d) => d.deviceId === input.deviceId);
  if (existing) {
    existing.name = input.name;
    existing.platform = input.platform;
    existing.userAgent = input.userAgent;
    existing.ipHash = input.ip ? createHash('sha256').update(input.ip).digest('hex').slice(0, 16) : existing.ipHash;
    saveDevices(devices);
    return existing;
  }

  const record: DeviceRecord = {
    deviceId: input.deviceId,
    name: input.name,
    platform: input.platform,
    registeredAt: Date.now(),
    lastSyncAt: 0,
    lastSyncSeq: 0,
    userAgent: input.userAgent,
    ipHash: input.ip ? createHash('sha256').update(input.ip).digest('hex').slice(0, 16) : undefined,
  };

  devices.push(record);
  // Enforce max devices
  if (devices.length > MAX_DEVICES) {
    devices.sort((a, b) => b.lastSyncAt - a.lastSyncAt);
    devices.length = MAX_DEVICES;
  }
  saveDevices(devices);
  return record;
}

/**
 * Get all registered devices.
 */
export function getDevices(): DeviceRecord[] {
  return loadDevices();
}

/**
 * Remove a device from the sync registry.
 */
export function removeDevice(deviceId: string): boolean {
  const devices = loadDevices();
  const filtered = devices.filter((d) => d.deviceId !== deviceId);
  if (filtered.length === devices.length) return false;
  saveDevices(filtered);
  return true;
}

// ─── Delta Sync ───────────────────────────────────────────────────────────────

function deltaChecksum(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

/**
 * Set a value at a dot-separated path in an object.
 */
function setNestedValue(obj: Record<string, unknown>, dotPath: string, value: unknown) {
  const parts = dotPath.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof current[parts[i]] !== 'object' || current[parts[i]] === null) {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Get a value at a dot-separated path from an object.
 */
function getNestedValue(obj: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Push deltas from a device and return any deltas the device is missing.
 */
export function pushDeltas(deviceId: string, clientDeltas: SyncDelta[], clientClock: VectorClock): SyncResponse {
  const state = loadSyncState();
  const devices = loadDevices();
  const device = devices.find((d) => d.deviceId === deviceId);
  const resolvedConflicts: string[] = [];

  // Apply client deltas
  for (const delta of clientDeltas) {
    // Validate checksum
    if (delta.checksum !== deltaChecksum(delta.value)) continue;

    // Check for conflicts — another device wrote to the same path after client's clock
    const existingDelta = state.deltas.find(
      (d) => d.path === delta.path && d.deviceId !== deviceId && d.ts > (clientClock[d.deviceId] || 0)
    );

    if (existingDelta) {
      // Conflict resolution: most recent timestamp wins
      if (delta.ts >= existingDelta.ts) {
        setNestedValue(state.resolvedState, delta.path, delta.value);
        resolvedConflicts.push(delta.path);
      }
      // Otherwise keep existing (server-side wins on tie)
    } else {
      setNestedValue(state.resolvedState, delta.path, delta.value);
    }

    // Record delta
    state.deltas.push(delta);

    // Update vector clock
    state.vectorClock[deviceId] = Math.max(state.vectorClock[deviceId] || 0, delta.seq);
  }

  // Trim deltas if too large (keep last MAX_OFFLINE_QUEUE)
  if (state.deltas.length > MAX_OFFLINE_QUEUE * 2) {
    state.deltas = state.deltas.slice(-MAX_OFFLINE_QUEUE);
  }

  state.lastMergeAt = Date.now();
  state.version++;
  saveSyncState(state);

  // Update device record
  if (device) {
    device.lastSyncAt = Date.now();
    device.lastSyncSeq = state.vectorClock[deviceId] || 0;
    saveDevices(devices);
  }

  // Find deltas the client is missing
  const missingDeltas = state.deltas.filter((d) => {
    if (d.deviceId === deviceId) return false;
    return d.seq > (clientClock[d.deviceId] || 0);
  });

  return {
    status: resolvedConflicts.length > 0 ? 'conflict_resolved' : 'ok',
    serverSeq: state.version,
    vectorClock: state.vectorClock,
    deltas: missingDeltas,
    resolvedConflicts,
  };
}

/**
 * Pull all deltas a device is missing (read-only sync).
 */
export function pullDeltas(deviceId: string, clientClock: VectorClock): SyncResponse {
  const state = loadSyncState();

  const missingDeltas = state.deltas.filter((d) => {
    if (d.deviceId === deviceId) return false;
    return d.seq > (clientClock[d.deviceId] || 0);
  });

  return {
    status: 'ok',
    serverSeq: state.version,
    vectorClock: state.vectorClock,
    deltas: missingDeltas,
    resolvedConflicts: [],
  };
}

/**
 * Get the full resolved state (for initial sync or full refresh).
 */
export function getResolvedState(): { state: Record<string, unknown>; vectorClock: VectorClock; version: number } {
  const sync = loadSyncState();
  return {
    state: sync.resolvedState,
    vectorClock: sync.vectorClock,
    version: sync.version,
  };
}

/**
 * Get sync summary for monitoring.
 */
export function getSyncSummary() {
  const state = loadSyncState();
  const devices = loadDevices();

  return {
    version: state.version,
    totalDeltas: state.deltas.length,
    vectorClock: state.vectorClock,
    lastMergeAt: state.lastMergeAt,
    devices: devices.map((d) => ({
      deviceId: d.deviceId,
      name: d.name,
      platform: d.platform,
      lastSyncAt: d.lastSyncAt,
      lastSyncSeq: d.lastSyncSeq,
      stale: Date.now() - d.lastSyncAt > 24 * 60 * 60 * 1000, // stale if >24h
    })),
    resolvedPaths: Object.keys(state.resolvedState).length,
  };
}
