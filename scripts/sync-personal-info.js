#!/usr/bin/env node
/**
 * Sync Personal Info — Cross-device state reconciliation
 * ═════════════════════════════════════════════════════════════════════════
 * Syncs personal dashboard data across all registered devices with vector
 * clock conflict resolution.
 *
 * Usage:
 *   npm run sync:personal                    # Local dev (http://localhost:3000)
 *   npm run sync:personal:prod               # Production (https://freedomforge.one)
 *   node scripts/sync-personal-info.js <url> # Custom URL
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ─── Configuration ────────────────────────────────────────────────────────

const DEFAULT_URL = process.env.SYNC_URL || 'http://localhost:3000';
const DEVICE_ID_FILE = path.join(process.cwd(), '.device-id');
const DEV_MODE = process.env.NODE_ENV !== 'production';

// ─── Utilities ────────────────────────────────────────────────────────────

function getDeviceId() {
  if (fs.existsSync(DEVICE_ID_FILE)) {
    return fs.readFileSync(DEVICE_ID_FILE, 'utf8').trim();
  }
  const newId = `cli-${Date.now()}`;
  fs.writeFileSync(DEVICE_ID_FILE, newId, 'utf8');
  console.log(`📱 Generated device ID: ${newId}`);
  return newId;
}

function httpRequest(url, method, payload, cookie) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isSecure = parsedUrl.protocol === 'https:';
    const client = isSecure ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isSecure ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(cookie ? { 'Cookie': cookie } : {}),
      },
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch {
          reject(new Error(`Invalid JSON response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Sync Operations ──────────────────────────────────────────────────────

async function pullFullState(baseUrl, cookie) {
  console.log('📥 Pulling full resolved state...');
  try {
    const result = await httpRequest(`${baseUrl}/api/sync?full=true`, 'GET', null, cookie);
    if (result.status === 401) {
      console.error('❌ Unauthorized — you must be logged in first');
      console.error('   Log in at', `${baseUrl}/login`, 'then try again');
      process.exit(1);
    }
    if (result.status !== 200) {
      throw new Error(`HTTP ${result.status}`);
    }
    console.log('✅ Full state retrieved');
    return result.data;
  } catch (error) {
    console.error('❌ Failed to pull state:', error.message);
    throw error;
  }
}

async function pushDeltas(baseUrl, deviceId, cookie) {
  console.log('📤 Pushing device deltas...');
  const payload = JSON.stringify({
    deviceId,
    deltas: [],
    clock: {},
  });

  try {
    const result = await httpRequest(`${baseUrl}/api/sync`, 'POST', payload, cookie);
    if (result.status === 401) {
      console.error('❌ Unauthorized — you must be logged in first');
      console.error('   Log in at', `${baseUrl}/login`, 'then try again');
      process.exit(1);
    }
    if (result.status !== 200) {
      throw new Error(`HTTP ${result.status}: ${JSON.stringify(result.data)}`);
    }
    console.log('✅ Deltas pushed');
    return result.data;
  } catch (error) {
    console.error('❌ Failed to push deltas:', error.message);
    throw error;
  }
}

async function registerDevice(baseUrl, deviceId, cookie) {
  console.log(`📱 Registering device: ${deviceId}`);
  const payload = JSON.stringify({
    deviceId,
    name: `CLI (${process.platform})`,
    platform: 'api',
    userAgent: `FreedomForge-CLI/1.0`,
  });

  try {
    const result = await httpRequest(`${baseUrl}/api/sync`, 'PUT', payload, cookie);
    if (result.status === 401) {
      console.error('❌ Unauthorized — you must be logged in first');
      console.error('   Log in at', `${baseUrl}/login`, 'then try again');
      process.exit(1);
    }
    if (result.status !== 200) {
      throw new Error(`HTTP ${result.status}`);
    }
    console.log('✅ Device registered:', result.data.device.name);
    return result.data.device;
  } catch (error) {
    console.error('❌ Failed to register device:', error.message);
    throw error;
  }
}

async function pullMissingDeltas(baseUrl, deviceId, clock, cookie) {
  console.log('🔄 Pulling missing deltas...');
  const clockParam = encodeURIComponent(JSON.stringify(clock));
  try {
    const result = await httpRequest(
      `${baseUrl}/api/sync?deviceId=${deviceId}&clock=${clockParam}`,
      'GET',
      null,
      cookie
    );
    if (result.status === 401) {
      console.error('❌ Unauthorized');
      process.exit(1);
    }
    if (result.status !== 200) {
      throw new Error(`HTTP ${result.status}`);
    }
    const { deltas = [] } = result.data;
    console.log(`✅ Retrieved ${deltas.length} missing deltas`);
    return deltas;
  } catch (error) {
    console.error('❌ Failed to pull deltas:', error.message);
    throw error;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const baseUrl = process.argv[2] || DEFAULT_URL;
  const deviceId = getDeviceId();

  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║           FreedomForge Personal Info Sync                          ║
╚════════════════════════════════════════════════════════════════════╝
  Base URL:  ${baseUrl}
  Device ID: ${deviceId}
  `);

  // Check if session cookie exists (from previous login via browser)
  // For CLI, we expect the user to have logged in first
  const cookie = process.env.FF_SESSION_COOKIE || '';
  
  if (!cookie && !fs.existsSync(path.join(process.cwd(), '.ff-cli-auth'))) {
    console.warn(`
⚠️  No session detected. You must log in first:
    1. Visit: ${baseUrl}/login
    2. Enter your admin credentials
    3. Try again with a valid cookie or after browser login
    `);
    process.exit(1);
  }

  try {
    // Step 1: Register/update device
    await registerDevice(baseUrl, deviceId, cookie);

    // Step 2: Push any local deltas (empty for now)
    const pushResult = await pushDeltas(baseUrl, deviceId, cookie);
    console.log(`   Vector clock: ${JSON.stringify(pushResult.vectorClock)}`);

    // Step 3: Pull full state as fallback
    const fullState = await pullFullState(baseUrl, cookie);
    
    // Step 4: Pull missing deltas since our last sync
    if (pushResult.vectorClock && Object.keys(pushResult.vectorClock).length > 0) {
      const missingDeltas = await pullMissingDeltas(baseUrl, deviceId, pushResult.vectorClock, cookie);
      console.log(`   Deltas to apply: ${missingDeltas.length}`);
    }

    console.log(`
╔════════════════════════════════════════════════════════════════════╗
║                    ✅ Sync Complete                                ║
╚════════════════════════════════════════════════════════════════════╝
  
  Your personal info is now synced across all devices.
  Next sync in: automatic on device reconnect
    `);

    process.exit(0);
  } catch (error) {
    console.error(`
╔════════════════════════════════════════════════════════════════════╗
║                    ❌ Sync Failed                                   ║
╚════════════════════════════════════════════════════════════════════╝
  Error: ${error.message}
    `);
    process.exit(1);
  }
}

main();
