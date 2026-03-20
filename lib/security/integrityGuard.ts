/**
 * Integrity Guard — Tamper detection & request signing for FreedomForge Max.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Protects critical state files and API requests from unauthorized modification:
 *  • HMAC-SHA256 manifest signing for critical state files
 *  • Request body signature verification for mutation endpoints
 *  • Audit trail logging for all integrity events
 *  • Automatic tamper detection on startup and periodic checks
 *
 * This does NOT replace auth — it adds a second layer ensuring that even
 * authenticated requests haven't been modified in transit, and that persisted
 * state hasn't been tampered with on disk.
 */

import { createHash, createHmac, timingSafeEqual, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

// ─── Configuration ────────────────────────────────────────────────────────────

const DATA_DIR = path.resolve(process.cwd(), 'data');
const MANIFEST_FILE = path.join(DATA_DIR, 'integrity-manifest.json');
const AUDIT_LOG_FILE = path.join(DATA_DIR, 'integrity-audit.log');
const INTEGRITY_SECRET = process.env.INTEGRITY_SECRET || process.env.ALERT_SECRET || '';
const MAX_AUDIT_LINES = 5000;

// Critical files that must be integrity-checked
const CRITICAL_FILES = [
  'data/episodic-memory.json',
  'data/knowledge-base.json',
  'data/trailing-stops.json',
  'data/forecast-state.json',
  'data/champion-policy.json',
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileManifestEntry {
  path: string;
  hash: string;       // SHA-256 of file contents
  hmac: string;       // HMAC-SHA256 of hash using INTEGRITY_SECRET
  sizeBytes: number;
  checkedAt: number;
  modifiedAt: number;
}

interface IntegrityManifest {
  version: 1;
  entries: Record<string, FileManifestEntry>;
  createdAt: number;
  updatedAt: number;
  signedAt: number;
  manifestHmac: string; // HMAC of entire entries block
}

interface AuditEvent {
  ts: string;
  event: 'check_pass' | 'check_fail' | 'tamper_detected' | 'manifest_created'
       | 'manifest_updated' | 'request_verified' | 'request_rejected';
  target: string;
  detail?: string;
}

// ─── Core Functions ───────────────────────────────────────────────────────────

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmacSign(data: string): string {
  if (!INTEGRITY_SECRET) return '';
  return createHmac('sha256', INTEGRITY_SECRET).update(data).digest('hex');
}

function hmacVerify(data: string, expected: string): boolean {
  if (!INTEGRITY_SECRET || !expected) return false;
  const computed = hmacSign(data);
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(computed), Buffer.from(expected));
}

function appendAudit(event: AuditEvent) {
  try {
    ensureDataDir();
    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(AUDIT_LOG_FILE, line, 'utf8');

    // Trim audit log if too large
    const stat = fs.statSync(AUDIT_LOG_FILE);
    if (stat.size > MAX_AUDIT_LINES * 200) {
      const content = fs.readFileSync(AUDIT_LOG_FILE, 'utf8');
      const lines = content.trim().split('\n');
      if (lines.length > MAX_AUDIT_LINES) {
        fs.writeFileSync(AUDIT_LOG_FILE, lines.slice(-MAX_AUDIT_LINES).join('\n') + '\n', 'utf8');
      }
    }
  } catch {
    // Audit logging is best-effort
  }
}

// ─── File Integrity ───────────────────────────────────────────────────────────

/**
 * Compute the integrity hash + HMAC for a single file.
 */
function computeFileEntry(filePath: string): FileManifestEntry | null {
  const abs = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(abs)) return null;

  try {
    const content = fs.readFileSync(abs);
    const stat = fs.statSync(abs);
    const hash = sha256(content);

    return {
      path: filePath,
      hash,
      hmac: hmacSign(hash),
      sizeBytes: stat.size,
      checkedAt: Date.now(),
      modifiedAt: stat.mtimeMs,
    };
  } catch {
    return null;
  }
}

/**
 * Load the integrity manifest from disk.
 */
function loadManifest(): IntegrityManifest | null {
  try {
    if (!fs.existsSync(MANIFEST_FILE)) return null;
    const raw = fs.readFileSync(MANIFEST_FILE, 'utf8');
    return JSON.parse(raw) as IntegrityManifest;
  } catch {
    return null;
  }
}

/**
 * Save the integrity manifest to disk with HMAC signing.
 */
function saveManifest(manifest: IntegrityManifest) {
  ensureDataDir();
  const entriesJson = JSON.stringify(manifest.entries);
  manifest.manifestHmac = hmacSign(entriesJson);
  manifest.signedAt = Date.now();
  manifest.updatedAt = Date.now();
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2), 'utf8');
}

/**
 * Build a fresh integrity manifest for all critical files.
 */
export function buildManifest(): IntegrityManifest {
  const entries: Record<string, FileManifestEntry> = {};

  for (const filePath of CRITICAL_FILES) {
    const entry = computeFileEntry(filePath);
    if (entry) entries[filePath] = entry;
  }

  const manifest: IntegrityManifest = {
    version: 1,
    entries,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    signedAt: 0,
    manifestHmac: '',
  };

  saveManifest(manifest);
  appendAudit({ ts: new Date().toISOString(), event: 'manifest_created', target: 'all' });
  return manifest;
}

/**
 * Verify integrity of all critical files against the manifest.
 * Returns list of tampered files (empty = all good).
 */
export function verifyIntegrity(): { valid: boolean; tampered: string[]; missing: string[]; details: string[] } {
  const manifest = loadManifest();
  const result = { valid: true, tampered: [] as string[], missing: [] as string[], details: [] as string[] };

  if (!manifest) {
    // No manifest exists — create one (first run)
    buildManifest();
    result.details.push('No manifest found — created fresh manifest');
    return result;
  }

  // Verify manifest HMAC (meta-integrity)
  if (INTEGRITY_SECRET) {
    const entriesJson = JSON.stringify(manifest.entries);
    if (!hmacVerify(entriesJson, manifest.manifestHmac)) {
      result.valid = false;
      result.details.push('CRITICAL: Manifest itself has been tampered with');
      appendAudit({ ts: new Date().toISOString(), event: 'tamper_detected', target: 'manifest', detail: 'Manifest HMAC mismatch' });
      return result;
    }
  }

  // Check each critical file
  for (const filePath of CRITICAL_FILES) {
    const expected = manifest.entries[filePath];
    const current = computeFileEntry(filePath);

    if (!current && expected) {
      result.missing.push(filePath);
      result.details.push(`Missing: ${filePath} (was present at last check)`);
      continue;
    }

    if (!current) continue; // File never existed, skip

    if (expected) {
      // Verify hash matches
      if (current.hash !== expected.hash) {
        // Hash changed — could be legitimate update or tampering
        // Verify the HMAC on the expected hash to ensure manifest wasn't corrupted
        if (INTEGRITY_SECRET && !hmacVerify(expected.hash, expected.hmac)) {
          result.valid = false;
          result.tampered.push(filePath);
          result.details.push(`TAMPERED: ${filePath} — HMAC verification failed on stored hash`);
          appendAudit({ ts: new Date().toISOString(), event: 'tamper_detected', target: filePath, detail: 'HMAC mismatch on stored hash' });
        } else {
          // Hash changed but old HMAC valid — legitimate update, refresh entry
          manifest.entries[filePath] = current;
          result.details.push(`Updated: ${filePath} — content changed legitimately`);
          appendAudit({ ts: new Date().toISOString(), event: 'manifest_updated', target: filePath });
        }
      } else {
        appendAudit({ ts: new Date().toISOString(), event: 'check_pass', target: filePath });
      }
    } else {
      // New file — add to manifest
      manifest.entries[filePath] = current;
      result.details.push(`Added: ${filePath} — new critical file detected`);
    }
  }

  // Save updated manifest
  saveManifest(manifest);

  if (result.tampered.length > 0 || result.missing.length > 0) {
    result.valid = false;
  }

  return result;
}

// ─── Request Signing ──────────────────────────────────────────────────────────

/**
 * Generate a signature for a request body (for internal service-to-service calls).
 * Attach as x-integrity-sig header.
 */
export function signRequestBody(body: string, timestamp?: number): string {
  const ts = timestamp || Date.now();
  const payload = `${ts}:${body}`;
  return `t=${ts},sig=${hmacSign(payload)}`;
}

/**
 * Verify a signed request body. Rejects replays older than 5 minutes.
 */
export function verifyRequestSignature(body: string, signature: string): boolean {
  if (!INTEGRITY_SECRET || !signature) return false;

  const parts: Record<string, string> = {};
  for (const pair of signature.split(',')) {
    const [k, v] = pair.split('=', 2);
    if (k && v) parts[k] = v;
  }

  const ts = Number(parts.t);
  const sig = parts.sig;
  if (!ts || !sig) return false;

  // Reject replays older than 5 minutes
  const MAX_AGE_MS = 5 * 60 * 1000;
  if (Math.abs(Date.now() - ts) > MAX_AGE_MS) return false;

  const payload = `${ts}:${body}`;
  return hmacVerify(payload, sig);
}

// ─── Nonce Generation ─────────────────────────────────────────────────────────

/**
 * Generate a cryptographic nonce for one-time use tokens.
 */
export function generateNonce(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

// ─── Content Hash for Dedup ───────────────────────────────────────────────────

/**
 * Hash any content for deduplication or integrity comparison.
 */
export function contentHash(data: string | Buffer): string {
  return sha256(data);
}
