#!/usr/bin/env node
/**
 * FreedomForge Integrity Guardian — Comprehensive 6-Hour Code & System Audit
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE ADULT IN THE ROOM. This is FreedomForge's immune system.
 *
 * Runs every 6 hours via ff-integrity-guardian.timer. Zero expiry.
 * Detects drift, corruption, unauthorized changes, resource rot,
 * and self-heals everything within its power.
 *
 * 30 checks across 6 domains:
 *   Domain 1 — CODE INTEGRITY (hash verification of critical files)
 *   Domain 2 — CONFIG DRIFT (env vars, systemd units, risk thresholds)
 *   Domain 3 — SERVICE HEALTH (all systemd services + timers alive)
 *   Domain 4 — DATA INTEGRITY (JSON schemas, freshness, size bounds)
 *   Domain 5 — FINANCIAL SAFETY (capital, positions, drawdown, payout)
 *   Domain 6 — INFRASTRUCTURE (disk, memory, git, tunnel, Vercel sync)
 *
 * Outputs:
 *   - logs/integrity-guardian-YYYY-MM-DD-HH.log (human-readable)
 *   - data/integrity-guardian-state.json (machine-readable)
 *   - Discord alert on CRITICAL findings (if webhook configured)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let rio; try { rio = require('../lib/resilient-io'); } catch { rio = null; }

// ─── CONFIGURATION ────────────────────────────────────────────────────────────

const BASE = process.env.REPO_DIR || '/home/opc/freedomforge-max';
const DATA = path.join(BASE, 'data');
const LOGS = path.join(BASE, 'logs');
const STATE_FILE = path.join(DATA, 'integrity-guardian-state.json');
const BASELINE_FILE = path.join(DATA, '.integrity-baseline.json');
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL || process.env.ALERT_WEBHOOK_URL || '';

// ─── CRITICAL FILES TO HASH-VERIFY ───────────────────────────────────────────
// If any of these change without a git commit, something is seriously wrong.

const CRITICAL_FILES = [
  'scripts/master-orchestrator.js',
  'scripts/scheduled-audit.js',
  'scripts/integrity-guardian.js',
  'scripts/watchdog.sh',
  'scripts/data-hygiene.js',
  'scripts/profit-scorecard.js',
  'scripts/sync-tunnel-url.sh',
  'scripts/tunnel-url-watcher.sh',
  'lib/liquidation-guardian.js',
  'lib/treasury-ledger.js',
  'lib/alerts.ts',
  'lib/gasTopup.ts',
  'app/api/status/empire/route.ts',
  'app/dashboard/page.tsx',
  'package.json',
];

// ─── EXPECTED SYSTEMD SERVICES ────────────────────────────────────────────────

const EXPECTED_SERVICES = {
  running: ['ff-dashboard', 'ff-dashboard-api', 'ff-tunnel', 'ff-tunnel-url', 'ff-watchdog'],
  timers: [
    'ff-orchestrator.timer', 'ff-guardian.timer',
    'ff-scaler.timer', 'ff-scheduled-audit.timer', 'ff-profit-scorecard.timer',
    'ff-continuous-learning.timer', 'ff-daily-kpi.timer',
    'ff-geopolitical-watch.timer', 'ff-monthly-strategy.timer',
    'ff-payout.timer', 'ff-data-hygiene.timer', 'ff-integrity-guardian.timer',
  ],
};

// ─── EXPECTED ENV KEYS (must exist in .env.local) ─────────────────────────────

const REQUIRED_ENV_KEYS = [
  'COINBASE_API_KEY', 'COINBASE_API_SECRET',
  'KRAKEN_API_KEY', 'KRAKEN_API_SECRET',
];

// ─── FINANCIAL SAFETY THRESHOLDS ──────────────────────────────────────────────

const SAFETY = {
  minCapital: 50,            // USD — below this is critical
  maxDrawdownPct: 50,        // % — above this triggers alert
  maxSinglePositionPct: 30,  // % of portfolio in one position
  maxOpenPositions: 200,     // sanity cap
  treasuryStaleMinutes: 30,  // treasury must update within this
  guardianStaleMinutes: 10,  // guardian must be this fresh
  orchestratorStaleMinutes: 15,
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const now = () => new Date().toISOString();
const tsLabel = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}-${String(d.getUTCHours()).padStart(2,'0')}`;
};

const findings = [];
let criticalCount = 0;
let warningCount = 0;
let healedCount = 0;
let passCount = 0;

function log(level, domain, msg, healed = false) {
  const line = `[${now()}] [${level}] [${domain}] ${msg}${healed ? ' → HEALED' : ''}`;
  console.log(line);
  findings.push({ ts: now(), level, domain, msg, healed });
  if (level === 'CRITICAL') criticalCount++;
  else if (level === 'WARN') warningCount++;
  if (healed) healedCount++;
}

function pass(domain, msg) {
  console.log(`[${now()}] [PASS] [${domain}] ${msg}`);
  passCount++;
}

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: opts.timeout || 30000,
      cwd: opts.cwd || BASE,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    return opts.fallback !== undefined ? opts.fallback : '';
  }
}

function readJson(filePath) {
  try {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(BASE, filePath);
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch { return null; }
}

function sha256(filePath) {
  try {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(BASE, filePath);
    const content = fs.readFileSync(abs);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch { return null; }
}

function fileAgeSeconds(filePath) {
  try {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(BASE, filePath);
    const stat = fs.statSync(abs);
    return Math.round((Date.now() - stat.mtimeMs) / 1000);
  } catch { return Infinity; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOMAIN 1 — CODE INTEGRITY
// ═══════════════════════════════════════════════════════════════════════════════

function auditCodeIntegrity() {
  const domain = 'CODE';
  console.log(`\n${'═'.repeat(70)}\n  DOMAIN 1 — CODE INTEGRITY\n${'═'.repeat(70)}`);

  // 1a. Compute current hashes
  const currentHashes = {};
  let missingFiles = 0;
  for (const f of CRITICAL_FILES) {
    const hash = sha256(f);
    if (!hash) {
      log('WARN', domain, `Critical file missing: ${f}`);
      missingFiles++;
    } else {
      currentHashes[f] = hash;
    }
  }
  if (missingFiles === 0) pass(domain, `All ${CRITICAL_FILES.length} critical files present`);

  // 1b. Compare against baseline
  let baseline = readJson(BASELINE_FILE);
  if (!baseline) {
    log('INFO', domain, 'No baseline found — creating initial baseline');
    baseline = { createdAt: now(), hashes: currentHashes };
    if (rio) { rio.writeJsonAtomic(BASELINE_FILE, baseline); }
    else {
      const _tmp = BASELINE_FILE + '.tmp';
      fs.writeFileSync(_tmp, JSON.stringify(baseline, null, 2));
      fs.renameSync(_tmp, BASELINE_FILE);
    }
    pass(domain, 'Baseline created with ' + Object.keys(currentHashes).length + ' file hashes');
  } else {
    let driftCount = 0;
    for (const [file, expectedHash] of Object.entries(baseline.hashes)) {
      const actual = currentHashes[file];
      if (!actual) continue; // already flagged as missing
      if (actual !== expectedHash) {
        // Check if this change is in git
        const gitStatus = run(`git diff --name-only HEAD -- "${file}"`);
        if (gitStatus) {
          log('WARN', domain, `Uncommitted change in ${file} (hash drift from baseline)`);
        } else {
          // File changed but is committed — legitimate change, update baseline
          baseline.hashes[file] = actual;
          baseline.lastUpdated = now();
          driftCount++;
        }
      }
    }
    // Add any new critical files to baseline
    for (const [file, hash] of Object.entries(currentHashes)) {
      if (!baseline.hashes[file]) {
        baseline.hashes[file] = hash;
        baseline.lastUpdated = now();
      }
    }
    if (driftCount > 0) {
      if (rio) { rio.writeJsonAtomic(BASELINE_FILE, baseline); }
      else {
        const _tmp = BASELINE_FILE + '.tmp';
        fs.writeFileSync(_tmp, JSON.stringify(baseline, null, 2));
        fs.renameSync(_tmp, BASELINE_FILE);
      }
      pass(domain, `Baseline updated: ${driftCount} committed changes absorbed`);
    } else {
      pass(domain, 'All file hashes match baseline');
    }
  }

  // 1c. Git cleanliness
  const gitDirty = run('git status --porcelain');
  if (gitDirty) {
    const changedFiles = gitDirty.split('\n').filter(l => l.trim()).length;
    log('WARN', domain, `Git working tree has ${changedFiles} uncommitted changes`);
  } else {
    pass(domain, 'Git working tree clean');
  }

  // 1d. Package-lock integrity
  const lockHash = sha256('package-lock.json');
  if (lockHash) {
    if (!baseline.packageLockHash) {
      baseline.packageLockHash = lockHash;
      if (rio) { rio.writeJsonAtomic(BASELINE_FILE, baseline); }
      else {
        const _tmp = BASELINE_FILE + '.tmp';
        fs.writeFileSync(_tmp, JSON.stringify(baseline, null, 2));
        fs.renameSync(_tmp, BASELINE_FILE);
      }
    } else if (baseline.packageLockHash !== lockHash) {
      log('WARN', domain, 'package-lock.json changed since baseline — dependency drift possible');
      baseline.packageLockHash = lockHash;
      baseline.lastUpdated = now();
      if (rio) { rio.writeJsonAtomic(BASELINE_FILE, baseline); }
      else {
        const _tmp = BASELINE_FILE + '.tmp';
        fs.writeFileSync(_tmp, JSON.stringify(baseline, null, 2));
        fs.renameSync(_tmp, BASELINE_FILE);
      }
    } else {
      pass(domain, 'package-lock.json matches baseline');
    }
  }

  // 1e. Module require test (JS only — TS files are compiled by Next.js)
  const coreModules = [
    'lib/liquidation-guardian.js',
    'lib/treasury-ledger.js',
  ];
  let moduleOk = 0;
  for (const mod of coreModules) {
    const testCmd = `node -e "try { require('./${mod.replace('.ts','')}'); process.exit(0); } catch(e) { console.error(e.message); process.exit(1); }"`;
    const result = run(testCmd, { fallback: 'FAIL' });
    if (result === 'FAIL') {
      log('CRITICAL', domain, `Core module failed to load: ${mod}`);
    } else {
      moduleOk++;
    }
  }
  if (moduleOk === coreModules.length) pass(domain, `All ${moduleOk} core modules load successfully`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOMAIN 2 — CONFIG DRIFT
// ═══════════════════════════════════════════════════════════════════════════════

function auditConfigDrift() {
  const domain = 'CONFIG';
  console.log(`\n${'═'.repeat(70)}\n  DOMAIN 2 — CONFIG DRIFT\n${'═'.repeat(70)}`);

  // 2a. .env.local key presence
  const envPath = path.join(BASE, '.env.local');
  if (!fs.existsSync(envPath)) {
    log('CRITICAL', domain, '.env.local is missing!');
    return;
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  const envKeys = new Set(
    envContent.split('\n')
      .filter(l => l.trim() && !l.startsWith('#'))
      .map(l => l.split('=')[0].trim())
  );

  let missingKeys = 0;
  for (const key of REQUIRED_ENV_KEYS) {
    if (!envKeys.has(key)) {
      log('CRITICAL', domain, `Required env key missing: ${key}`);
      missingKeys++;
    }
  }
  if (missingKeys === 0) pass(domain, `All ${REQUIRED_ENV_KEYS.length} required env keys present`);

  // 2b. .env.local hash tracking (detect unauthorized edits)
  const envHash = sha256(envPath);
  let baseline = readJson(BASELINE_FILE) || {};
  if (!baseline.envHash) {
    baseline.envHash = envHash;
    baseline.envKeyCount = envKeys.size;
    if (rio) { rio.writeJsonAtomic(BASELINE_FILE, baseline); }
    else {
      const _tmp = BASELINE_FILE + '.tmp';
      fs.writeFileSync(_tmp, JSON.stringify(baseline, null, 2));
      fs.renameSync(_tmp, BASELINE_FILE);
    }
    pass(domain, `Env baseline set: ${envKeys.size} keys`);
  } else if (baseline.envHash !== envHash) {
    const keyDelta = envKeys.size - (baseline.envKeyCount || 0);
    log('WARN', domain, `.env.local changed since last audit (keys: ${baseline.envKeyCount} → ${envKeys.size}, delta: ${keyDelta > 0 ? '+' : ''}${keyDelta})`);
    baseline.envHash = envHash;
    baseline.envKeyCount = envKeys.size;
    baseline.envLastChanged = now();
    if (rio) { rio.writeJsonAtomic(BASELINE_FILE, baseline); }
    else {
      const _tmp = BASELINE_FILE + '.tmp';
      fs.writeFileSync(_tmp, JSON.stringify(baseline, null, 2));
      fs.renameSync(_tmp, BASELINE_FILE);
    }
  } else {
    pass(domain, `.env.local unchanged (${envKeys.size} keys)`);
  }

  // 2c. INITIAL_CAPITAL consistency
  const capitalLine = envContent.split('\n').find(l => l.startsWith('INITIAL_CAPITAL='));
  if (capitalLine) {
    const val = parseFloat(capitalLine.split('=')[1]);
    const treasury = readJson('data/treasury-ledger.json');
    if (treasury && treasury.initialCapital !== val) {
      log('WARN', domain, `INITIAL_CAPITAL mismatch: env=${val}, treasury=${treasury.initialCapital}`);
    } else {
      pass(domain, `INITIAL_CAPITAL consistent: $${val}`);
    }
  }

  // 2d. Systemd unit file integrity
  const unitFiles = run('find /etc/systemd/system -name "ff-*" -type f 2>/dev/null');
  if (unitFiles) {
    const units = unitFiles.split('\n').filter(Boolean);
    const unitHashMap = {};
    for (const u of units) {
      unitHashMap[path.basename(u)] = sha256(u);
    }
    if (!baseline.systemdUnitHashes) {
      baseline.systemdUnitHashes = unitHashMap;
      if (rio) { rio.writeJsonAtomic(BASELINE_FILE, baseline); }
      else {
        const _tmp = BASELINE_FILE + '.tmp';
        fs.writeFileSync(_tmp, JSON.stringify(baseline, null, 2));
        fs.renameSync(_tmp, BASELINE_FILE);
      }
      pass(domain, `Systemd unit baseline set: ${units.length} files`);
    } else {
      let changed = 0;
      for (const [name, hash] of Object.entries(unitHashMap)) {
        if (baseline.systemdUnitHashes[name] && baseline.systemdUnitHashes[name] !== hash) {
          log('WARN', domain, `Systemd unit changed: ${name}`);
          changed++;
        }
      }
      if (changed === 0) pass(domain, `All ${units.length} systemd unit files unchanged`);
      baseline.systemdUnitHashes = unitHashMap;
      if (rio) { rio.writeJsonAtomic(BASELINE_FILE, baseline); }
      else {
        const _tmp = BASELINE_FILE + '.tmp';
        fs.writeFileSync(_tmp, JSON.stringify(baseline, null, 2));
        fs.renameSync(_tmp, BASELINE_FILE);
      }
    }
  }

  // 2e. SELinux context on .env.local
  const selinux = run('ls -Z /home/opc/freedomforge-max/.env.local 2>/dev/null');
  if (selinux && selinux.includes('unlabeled')) {
    log('WARN', domain, 'SELinux context missing on .env.local — fixing');
    run('sudo restorecon /home/opc/freedomforge-max/.env.local 2>/dev/null');
    healedCount++;
  } else {
    pass(domain, 'SELinux context OK');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOMAIN 3 — SERVICE HEALTH
// ═══════════════════════════════════════════════════════════════════════════════

function auditServiceHealth() {
  const domain = 'SERVICES';
  console.log(`\n${'═'.repeat(70)}\n  DOMAIN 3 — SERVICE HEALTH\n${'═'.repeat(70)}`);

  // 3a. Long-running services must be active
  for (const svc of EXPECTED_SERVICES.running) {
    const active = run(`systemctl is-active ${svc} 2>/dev/null`);
    if (active !== 'active') {
      log('CRITICAL', domain, `${svc} is ${active || 'unknown'} — restarting`);
      run(`sudo systemctl restart ${svc}`);
      const check = run(`systemctl is-active ${svc} 2>/dev/null`);
      if (check === 'active') {
        log('INFO', domain, `${svc} restarted successfully`, true);
      } else {
        log('CRITICAL', domain, `${svc} FAILED to restart`);
      }
    } else {
      pass(domain, `${svc}: active`);
    }
  }

  // 3b. Timers must be active
  let timerOk = 0;
  for (const timer of EXPECTED_SERVICES.timers) {
    const active = run(`systemctl is-active ${timer} 2>/dev/null`);
    if (active !== 'active') {
      log('WARN', domain, `Timer ${timer} is ${active || 'missing'} — enabling`);
      run(`sudo systemctl enable --now ${timer} 2>/dev/null`);
      const check = run(`systemctl is-active ${timer} 2>/dev/null`);
      if (check === 'active') {
        log('INFO', domain, `Timer ${timer} re-enabled`, true);
      } else {
        log('CRITICAL', domain, `Timer ${timer} FAILED to enable`);
      }
    } else {
      timerOk++;
    }
  }
  if (timerOk === EXPECTED_SERVICES.timers.length) {
    pass(domain, `All ${timerOk} timers active`);
  }

  // 3c. Check for failed units
  const failed = run('systemctl --failed --no-pager --plain --no-legend 2>/dev/null');
  if (failed) {
    const failedUnits = failed.split('\n').filter(l => l.includes('ff-')).map(l => l.split(/\s+/)[0]);
    for (const unit of failedUnits) {
      log('WARN', domain, `Failed unit: ${unit} — resetting`);
      run(`sudo systemctl reset-failed ${unit} 2>/dev/null`);
      healedCount++;
    }
  } else {
    pass(domain, 'No failed systemd units');
  }

  // 3d. Dashboard HTTP health
  const httpCode = run('curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/api/alchemy/health 2>/dev/null');
  if (httpCode !== '200') {
    log('CRITICAL', domain, `Dashboard API returned HTTP ${httpCode} — restarting`);
    run('sudo systemctl restart ff-dashboard');
    healedCount++;
  } else {
    pass(domain, 'Dashboard API: HTTP 200');
  }

  // 3e. Tunnel health
  const tunnelUrl = run('cat /home/opc/freedomforge-max/data/tunnel-url.txt 2>/dev/null');
  if (tunnelUrl) {
    const tunnelHttp = run(`curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${tunnelUrl}/api/alchemy/health" 2>/dev/null`);
    if (tunnelHttp !== '200') {
      log('WARN', domain, `Tunnel returned HTTP ${tunnelHttp} — restarting tunnel`);
      run('sudo systemctl restart ff-tunnel');
      healedCount++;
    } else {
      pass(domain, 'Tunnel: HTTP 200');
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOMAIN 4 — DATA INTEGRITY
// ═══════════════════════════════════════════════════════════════════════════════

function auditDataIntegrity() {
  const domain = 'DATA';
  console.log(`\n${'═'.repeat(70)}\n  DOMAIN 4 — DATA INTEGRITY\n${'═'.repeat(70)}`);

  const dataFiles = {
    'data/orchestrator-state.json': { maxAge: SAFETY.orchestratorStaleMinutes * 60, required: ['cycleCount', 'lastRunAt'] },
    'data/liquidation-guardian-state.json': { maxAge: SAFETY.guardianStaleMinutes * 60, required: ['lastCheck', 'coinbase', 'kraken'] },
    'data/treasury-ledger.json': { maxAge: SAFETY.treasuryStaleMinutes * 60, required: ['currentCapital', 'initialCapital', 'lifetimePnl'] },
    'data/trade-journal.json': { maxAge: 3600, required: ['trades'] },
    'data/capital-mandate-state.json': { maxAge: 3600, required: ['initialCapital'] },
  };

  for (const [file, spec] of Object.entries(dataFiles)) {
    const data = readJson(file);
    if (!data) {
      log('CRITICAL', domain, `Data file missing or corrupt: ${file}`);
      continue;
    }

    // Schema check
    let schemaOk = true;
    for (const key of spec.required) {
      if (data[key] === undefined) {
        log('WARN', domain, `${file} missing required key: ${key}`);
        schemaOk = false;
      }
    }
    if (schemaOk) pass(domain, `${file}: schema OK`);

    // Freshness check
    const age = fileAgeSeconds(file);
    if (age > spec.maxAge) {
      log('WARN', domain, `${file} is stale: ${age}s old (max: ${spec.maxAge}s)`);
    } else {
      pass(domain, `${file}: fresh (${age}s old)`);
    }

    // Size check (files >10MB are suspicious)
    try {
      const stat = fs.statSync(path.join(BASE, file));
      if (stat.size > 10 * 1024 * 1024) {
        log('WARN', domain, `${file} is ${(stat.size / 1024 / 1024).toFixed(1)}MB — needs pruning`);
      }
    } catch (err) { log('WARN', domain, `stat check failed for ${file}: ${err?.message}`); }
  }

  // 4b. Trade journal integrity
  const journal = readJson('data/trade-journal.json');
  if (journal && Array.isArray(journal.trades)) {
    const trades = journal.trades;
    const openTrades = trades.filter(t => !t.outcome);
    const closedTrades = trades.filter(t => t.outcome);

    // Check for duplicate trade IDs
    const ids = trades.map(t => t.orderId || t.id).filter(Boolean);
    const uniqueIds = new Set(ids);
    if (ids.length > 0 && uniqueIds.size < ids.length) {
      log('WARN', domain, `Trade journal has ${ids.length - uniqueIds.size} duplicate order IDs`);
    }

    pass(domain, `Trade journal: ${trades.length} trades (${openTrades.length} open, ${closedTrades.length} closed)`);
  }

  // 4c. Audit history size management
  const auditHistory = readJson('data/audit-history.json');
  if (auditHistory && Array.isArray(auditHistory) && auditHistory.length > 100) {
    const trimmed = auditHistory.slice(-50);
    const _ahPath = path.join(DATA, 'audit-history.json');
    if (rio) { rio.writeJsonAtomic(_ahPath, trimmed); }
    else {
      const _tmp = _ahPath + '.tmp';
      fs.writeFileSync(_tmp, JSON.stringify(trimmed, null, 2));
      fs.renameSync(_tmp, _ahPath);
    }
    log('INFO', domain, `Trimmed audit-history.json from ${auditHistory.length} to 50 entries`, true);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOMAIN 5 — FINANCIAL SAFETY
// ═══════════════════════════════════════════════════════════════════════════════

function auditFinancialSafety() {
  const domain = 'FINANCE';
  console.log(`\n${'═'.repeat(70)}\n  DOMAIN 5 — FINANCIAL SAFETY\n${'═'.repeat(70)}`);

  // 5a. Capital check
  const treasury = readJson('data/treasury-ledger.json');
  if (!treasury) {
    log('CRITICAL', domain, 'Treasury ledger missing!');
    return;
  }

  const capital = treasury.currentCapital || 0;
  if (capital < SAFETY.minCapital) {
    log('CRITICAL', domain, `Capital dangerously low: $${capital.toFixed(2)} (min: $${SAFETY.minCapital})`);
  } else {
    pass(domain, `Capital: $${capital.toFixed(2)} (OK)`);
  }

  // 5b. Drawdown check
  const peak = treasury.peakCapital || capital;
  const drawdownPct = peak > 0 ? ((peak - capital) / peak) * 100 : 0;
  if (drawdownPct > SAFETY.maxDrawdownPct) {
    log('CRITICAL', domain, `Drawdown at ${drawdownPct.toFixed(1)}% (max: ${SAFETY.maxDrawdownPct}%)`);
  } else {
    pass(domain, `Drawdown: ${drawdownPct.toFixed(1)}% from peak $${peak.toFixed(2)}`);
  }

  // 5c. Position concentration check
  const guardian = readJson('data/liquidation-guardian-state.json');
  if (guardian) {
    const cbPositions = guardian.coinbase?.positions || [];
    const krPositions = guardian.kraken?.positions || [];
    const allPositions = [...cbPositions, ...krPositions];
    const totalBalance = (guardian.coinbase?.totalBalance || 0) + (guardian.kraken?.equity || 0);

    if (allPositions.length > SAFETY.maxOpenPositions) {
      log('WARN', domain, `Too many open positions: ${allPositions.length} (max: ${SAFETY.maxOpenPositions})`);
    } else {
      pass(domain, `Open positions: ${allPositions.length}`);
    }

    // Check for oversized single positions
    for (const pos of allPositions) {
      const posSize = Math.abs(pos.notionalValue || pos.contracts * (pos.currentPrice || 0));
      if (totalBalance > 0 && posSize > 0) {
        const pct = (posSize / totalBalance) * 100;
        if (pct > SAFETY.maxSinglePositionPct) {
          log('WARN', domain, `Position ${pos.productId || pos.pair} is ${pct.toFixed(1)}% of portfolio (max: ${SAFETY.maxSinglePositionPct}%)`);
        }
      }
    }

    // 5d. Margin safety
    const cbMargin = guardian.coinbase?.marginPct || 0;
    const krMargin = guardian.kraken?.marginPct || 0;
    if (cbMargin > 85) {
      log('CRITICAL', domain, `Coinbase margin at ${cbMargin.toFixed(1)}% — liquidation risk!`);
    } else if (cbMargin > 70) {
      log('WARN', domain, `Coinbase margin at ${cbMargin.toFixed(1)}% — elevated risk`);
    } else {
      pass(domain, `CB margin: ${cbMargin.toFixed(1)}%, KR margin: ${krMargin.toFixed(1)}%`);
    }
  }

  // 5e. Kill switch check
  const killSwitch = readJson('data/kill-switch.json');
  if (killSwitch?.active) {
    log('CRITICAL', domain, `Kill switch is ACTIVE: ${killSwitch.reason || 'unknown reason'}`);
  } else {
    pass(domain, 'Kill switch: inactive');
  }

  // 5f. Payout integrity (15% floor enforcement)
  const payoutState = readJson('data/payout-state.json');
  if (payoutState) {
    const ownerPct = payoutState.ownerPct || payoutState.payoutPct || 0;
    if (ownerPct > 0 && ownerPct < 15) {
      log('WARN', domain, `Payout % below Ironclad floor: ${ownerPct}% (min: 15%)`);
    }
  }

  // 5g. Win rate trend (alert on prolonged losing streak)
  if (treasury.lifetimeTrades > 20) {
    const winRate = treasury.lifetimeWins / treasury.lifetimeTrades;
    if (winRate < 0.30) {
      log('WARN', domain, `Win rate critically low: ${(winRate * 100).toFixed(1)}% (${treasury.lifetimeWins}/${treasury.lifetimeTrades})`);
    } else {
      pass(domain, `Win rate: ${(winRate * 100).toFixed(1)}% (${treasury.lifetimeWins}W / ${treasury.lifetimeLosses}L)`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOMAIN 6 — INFRASTRUCTURE
// ═══════════════════════════════════════════════════════════════════════════════

function auditInfrastructure() {
  const domain = 'INFRA';
  console.log(`\n${'═'.repeat(70)}\n  DOMAIN 6 — INFRASTRUCTURE\n${'═'.repeat(70)}`);

  // 6a. Disk space
  const diskPct = parseInt(run("df / --output=pcent | tail -1 | tr -d ' %'"), 10);
  if (diskPct > 90) {
    log('CRITICAL', domain, `Disk usage critical: ${diskPct}%`);
    run('sudo journalctl --vacuum-size=20M 2>/dev/null');
    healedCount++;
  } else if (diskPct > 80) {
    log('WARN', domain, `Disk usage high: ${diskPct}%`);
  } else {
    pass(domain, `Disk: ${diskPct}% used`);
  }

  // 6b. Memory
  const memLine = run("awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo");
  const memAvail = parseInt(memLine, 10) || 0;
  if (memAvail < 300) {
    log('CRITICAL', domain, `Memory critically low: ${memAvail}MB available`);
  } else if (memAvail < 500) {
    log('WARN', domain, `Memory low: ${memAvail}MB available`);
  } else {
    pass(domain, `Memory: ${memAvail}MB available`);
  }

  // 6c. Node.js process count (zombie detector)
  const nodeCount = parseInt(run("pgrep -c node 2>/dev/null || echo 0"), 10);
  if (nodeCount > 30) {
    log('WARN', domain, `${nodeCount} node processes running — possible zombie leak`);
    // Kill zombie node processes older than 2 hours (except dashboard)
    run('pgrep -f "node.*scripts" --older 7200 2>/dev/null | xargs -r kill 2>/dev/null');
  } else {
    pass(domain, `Node processes: ${nodeCount}`);
  }

  // 6d. Journal error scan (last 6 hours)
  const errorCount = parseInt(run("journalctl --since '6 hours ago' -p err --no-pager -o cat 2>/dev/null | grep -c 'ff-' || echo 0"), 10);
  if (errorCount > 50) {
    log('WARN', domain, `${errorCount} journal errors in last 6h (ff-* services)`);
  } else {
    pass(domain, `Journal errors (6h): ${errorCount}`);
  }

  // 6e. Git branch check (should be on main)
  const branch = run('git branch --show-current');
  if (branch && branch !== 'main') {
    log('WARN', domain, `Git branch is '${branch}' (expected: main)`);
  } else {
    pass(domain, 'Git branch: main');
  }

  // 6f. Git remote sync check
  run('git fetch origin main --quiet 2>/dev/null');
  const behind = run('git rev-list HEAD..origin/main --count 2>/dev/null');
  const behindCount = parseInt(behind, 10) || 0;
  if (behindCount > 0) {
    log('WARN', domain, `Local is ${behindCount} commits behind origin/main`);
    // Auto-sync if behind (safe because services read data/ not .next/)
    const pullResult = run('git pull origin main --ff-only 2>&1', { fallback: 'FAIL' });
    if (pullResult !== 'FAIL') {
      log('INFO', domain, `Auto-synced ${behindCount} commits from origin/main`, true);
    }
  } else {
    pass(domain, 'Git: in sync with origin/main');
  }

  // 6g. Tunnel URL synchronization
  const tunnelUrl = run('cat /home/opc/freedomforge-max/data/tunnel-url.txt 2>/dev/null');
  const lastSynced = run('cat /home/opc/freedomforge-max/data/.last-synced-tunnel-url 2>/dev/null');
  if (tunnelUrl && lastSynced && tunnelUrl !== lastSynced) {
    log('WARN', domain, `Tunnel URL out of sync: current=${tunnelUrl}, synced=${lastSynced}`);
    run('bash scripts/sync-tunnel-url.sh 2>/dev/null &');
    log('INFO', domain, 'Triggered tunnel URL sync to Railway', true);
  } else if (tunnelUrl && lastSynced) {
    pass(domain, 'Tunnel URL synced with Railway');
  }

  // 6h. Uptime check
  const uptime = run('uptime -p');
  pass(domain, `Uptime: ${uptime}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTING
// ═══════════════════════════════════════════════════════════════════════════════

function generateReport() {
  const grade = criticalCount > 0 ? 'F' : warningCount > 3 ? 'D' : warningCount > 1 ? 'C' : warningCount === 1 ? 'B' : 'A';

  const report = {
    ts: now(),
    grade,
    summary: {
      critical: criticalCount,
      warnings: warningCount,
      healed: healedCount,
      passed: passCount,
      totalChecks: passCount + criticalCount + warningCount,
    },
    findings: findings.filter(f => f.level !== 'INFO' || f.healed),
    system: {
      uptime: run('uptime -p'),
      diskPct: parseInt(run("df / --output=pcent | tail -1 | tr -d ' %'"), 10),
      memAvailMB: parseInt(run("awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo"), 10),
      nodeProcesses: parseInt(run("pgrep -c node 2>/dev/null || echo 0"), 10),
    },
  };

  // Save state
  if (rio) { rio.writeJsonAtomic(STATE_FILE, report); }
  else {
    const _tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(_tmp, JSON.stringify(report, null, 2));
    fs.renameSync(_tmp, STATE_FILE);
  }

  // Save log file
  fs.mkdirSync(LOGS, { recursive: true });
  const logFile = path.join(LOGS, `integrity-guardian-${tsLabel()}.log`);
  const logContent = findings.map(f => `[${f.ts}] [${f.level}] [${f.domain}] ${f.msg}${f.healed ? ' → HEALED' : ''}`).join('\n');
  const logTmp = logFile + '.tmp';
  fs.writeFileSync(logTmp, logContent);
  fs.renameSync(logTmp, logFile);

  // Update audit history
  const histFile = path.join(DATA, 'integrity-audit-history.json');
  let history = [];
  try { history = JSON.parse(fs.readFileSync(histFile, 'utf8')); } catch {}
  history.push({ ts: now(), grade, critical: criticalCount, warnings: warningCount, healed: healedCount, passed: passCount });
  if (history.length > 120) history = history.slice(-100); // keep 100 most recent (~25 days at 6h)
  if (rio) { rio.writeJsonAtomic(histFile, history); }
  else {
    const _tmp = histFile + '.tmp';
    fs.writeFileSync(_tmp, JSON.stringify(history, null, 2));
    fs.renameSync(_tmp, histFile);
  }

  // Print summary
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  INTEGRITY GUARDIAN REPORT — Grade: ${grade}`);
  console.log(`${'═'.repeat(70)}`);
  console.log(`  Critical:  ${criticalCount}`);
  console.log(`  Warnings:  ${warningCount}`);
  console.log(`  Healed:    ${healedCount}`);
  console.log(`  Passed:    ${passCount}`);
  console.log(`  Total:     ${report.summary.totalChecks} checks`);
  console.log(`${'═'.repeat(70)}\n`);

  // Discord alert on critical findings
  if (criticalCount > 0 && DISCORD_WEBHOOK) {
    try {
      const msg = {
        content: `🚨 **FreedomForge Integrity Alert** — Grade: **${grade}**\n` +
          `Critical: ${criticalCount} | Warnings: ${warningCount} | Healed: ${healedCount}\n` +
          findings.filter(f => f.level === 'CRITICAL').map(f => `• ${f.msg}`).join('\n'),
      };
      // FIX M-2: Use stdin to avoid shell injection from single quotes in messages
      const { execFileSync } = require('child_process');
      const payload = JSON.stringify(msg);
      execFileSync('curl', ['-s', '-X', 'POST', '-H', 'Content-Type: application/json', '-d', payload, DISCORD_WEBHOOK], { encoding: 'utf8', timeout: 10000 });
    } catch (err) { console.error('[integrity-guardian] discord alert failed:', err?.message || err); }
  }

  return report;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(70)}`);
console.log(`  FREEDOMFORGE INTEGRITY GUARDIAN`);
console.log(`  Comprehensive 6-Hour Code & System Audit`);
console.log(`  ${now()}`);
console.log(`${'═'.repeat(70)}`);

auditCodeIntegrity();
auditConfigDrift();
auditServiceHealth();
auditDataIntegrity();
auditFinancialSafety();
auditInfrastructure();
const report = generateReport();

process.exit(report.summary.critical > 0 ? 1 : 0);
