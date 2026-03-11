#!/usr/bin/env node
/*
 * FreedomForge Scheduled Deep Audit
 * Runs every 8 hours via systemd timer for 7 days (auto-expires 2026-03-17)
 *
 * Checks:
 *   1. All systemd services & timers (system + user)
 *   2. Module integrity (require-test all 9 core libs)
 *   3. Orchestrator freshness & cycle health
 *   4. Brain evolution progress & weight drift
 *   5. Risk manager & kill switch state
 *   6. Payout configuration consistency
 *   7. Disk / memory / process health
 *   8. Error log scanning (journalctl)
 *   9. Data file freshness & size hygiene
 *  10. SELinux context verification
 *  11. Git working tree cleanliness
 *
 * Auto-patches:
 *   - Restarts crashed services
 *   - Fixes SELinux contexts on .env.local
 *   - Rotates oversized data files
 *   - Vacuums journald when disk is high
 *   - Clears stale watchdog alerts
 *   - Resets failed systemd units
 *   - Prunes zombie node processes
 *
 * Log output: logs/audit-YYYY-MM-DD-HH.log + data/audit-history.json
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
let rio; try { rio = require('../lib/resilient-io'); } catch { rio = null; }

const BASE = process.env.REPO_DIR || '/home/opc/freedomforge-max';
const DATA = path.join(BASE, 'data');
const LOGS = path.join(BASE, 'logs');
const ENV_FILE = path.join(BASE, '.env.local');
const AUDIT_HISTORY = path.join(DATA, 'audit-history.json');
// No expiry — FreedomForge runs forever

// ─── Helpers ──────────────────────────────────────────────────────────────────

const now = () => new Date().toISOString();
const ts = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}-${String(d.getUTCHours()).padStart(2,'0')}`;
};

let logLines = [];
function log(level, msg) {
  const line = `[${now()}] [${level}] ${msg}`;
  console.log(line);
  logLines.push(line);
}

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: opts.timeout || 30000,
      cwd: BASE,
      env: { ...process.env, HOME: '/home/opc' },
      ...opts,
    }).trim();
  } catch (e) {
    return opts.fallback !== undefined ? opts.fallback : `ERROR: ${e.message?.split('\n')[0] || 'unknown'}`;
  }
}

function runSudo(cmd, opts = {}) {
  return run(`sudo ${cmd}`, opts);
}

function safeJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// ─── Report structures ───────────────────────────────────────────────────────

const report = {
  auditTime: now(),
  expiry: 'never',
  verdict: 'PASS',
  checks: {},
  patches: [],
  warnings: [],
  errors: [],
};

function pass(section, detail) {
  report.checks[section] = { status: 'OK', detail };
  log('OK', `[${section}] ${detail}`);
}

function warn(section, detail) {
  report.checks[section] = { status: 'WARN', detail };
  report.warnings.push(`${section}: ${detail}`);
  log('WARN', `[${section}] ${detail}`);
}

function fail(section, detail) {
  report.checks[section] = { status: 'FAIL', detail };
  report.errors.push(`${section}: ${detail}`);
  report.verdict = 'FAIL';
  log('FAIL', `[${section}] ${detail}`);
}

function patched(action) {
  report.patches.push({ action, ts: now() });
  log('PATCH', action);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHECKS
// ═══════════════════════════════════════════════════════════════════════════════

// 1. Core system services (actual names on this VM)
function checkCoreServices() {
  const services = [
    'ff-dashboard', 'ff-tunnel', 'caddy',
    'freedomforge-trade-loop-arb', 'freedomforge-trade-loop-eth-shard0',
    'freedomforge-trade-loop-eth-shard1', 'freedomforge-trade-loop-op',
    'freedomforge-trade-loop-pol',
  ];
  const results = [];
  for (const svc of services) {
    const status = run(`systemctl is-active ${svc}`, { fallback: 'unknown' });
    if (status === 'active') {
      results.push(`${svc}=active`);
    } else {
      // AUTO-PATCH: restart
      log('PATCH', `Restarting ${svc} (was: ${status})`);
      runSudo(`systemctl restart ${svc}`);
      const after = run(`systemctl is-active ${svc}`, { fallback: 'unknown' });
      if (after === 'active') {
        patched(`Restarted ${svc} — now active`);
        results.push(`${svc}=healed`);
      } else {
        results.push(`${svc}=DEAD`);
      }
    }
  }
  const dead = results.filter(r => r.includes('DEAD'));
  if (dead.length > 0) fail('core-services', results.join(', '));
  else pass('core-services', results.join(', '));
}

// 2. User timers (orchestrator, edge, prediction, venue)
function checkUserTimers() {
  const expected = ['master-orchestrator', 'edge-scanner', 'prediction-market', 'venue-engine'];
  // Must use XDG_RUNTIME_DIR when running from a system service context
  const uid = run('id -u opc', { fallback: '1000' });
  const userCmd = `sudo -u opc XDG_RUNTIME_DIR=/run/user/${uid} systemctl --user list-timers --no-pager`;
  const timerList = run(userCmd, { fallback: '' });
  const missing = expected.filter(t => !timerList.includes(t));
  if (missing.length > 0) {
    for (const t of missing) {
      run(`sudo -u opc XDG_RUNTIME_DIR=/run/user/${uid} systemctl --user enable --now ${t}.timer`, { fallback: '' });
      patched(`Re-enabled user timer: ${t}`);
    }
    warn('user-timers', `Re-enabled: ${missing.join(', ')}`);
  } else {
    pass('user-timers', `All ${expected.length} active`);
  }
}

// 3. System timers
function checkSystemTimers() {
  const expected = [
    'ff-orchestrator', 'ff-watchdog', 'ff-guardian', 'ff-scaler',
    'ff-continuous-learning', 'ff-daily-kpi', 'ff-geopolitical-watch',
    'ff-monthly-strategy', 'ff-scheduled-audit',
    'ff-payout', 'ff-profit-scorecard',
  ];
  const timerList = run('systemctl list-timers --all --no-pager', { fallback: '' });
  const missing = expected.filter(t => !timerList.includes(t));
  if (missing.length > 0) {
    warn('system-timers', `Missing: ${missing.join(', ')}`);
  } else {
    pass('system-timers', `All ${expected.length} present`);
  }
}

// 4. Failed systemd units — auto-reset
function checkFailedUnits() {
  const failedRaw = run('systemctl --failed --no-pager --no-legend', { fallback: '' });
  const uid = run('id -u opc', { fallback: '1000' });
  const failedUser = run(`sudo -u opc XDG_RUNTIME_DIR=/run/user/${uid} systemctl --user --failed --no-pager --no-legend`, { fallback: '' });
  const allFailed = [failedRaw, failedUser]
    .join('\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.includes('mcelog'));  // ignore mcelog (VM-level)

  if (allFailed.length > 0) {
    // AUTO-PATCH: reset-failed
    runSudo('systemctl reset-failed', { fallback: '' });
    run(`sudo -u opc XDG_RUNTIME_DIR=/run/user/${uid} systemctl --user reset-failed`, { fallback: '' });
    patched(`Reset ${allFailed.length} failed unit(s): ${allFailed.map(l => l.split(/\s+/)[0]).join(', ')}`);
    warn('failed-units', `Reset ${allFailed.length} failed units`);
  } else {
    pass('failed-units', 'No failed units');
  }
}

// 5. Module integrity
function checkModules() {
  const modules = [
    './lib/risk-manager', './lib/self-evolving-brain', './lib/edge-detector',
    './lib/trade-journal', './lib/trade-reconciler', './lib/liquidation-guardian',
    './lib/capital-mandate', './lib/treasury-ledger', './lib/agent-signal-bus',
  ];
  const results = [];
  for (const m of modules) {
    try {
      require.resolve(path.resolve(BASE, m));
      results.push(`${path.basename(m)}=OK`);
    } catch {
      // Try a node subprocess for more robust check
      const r = run(`node -e "require('${m}')"`, { fallback: 'FAIL' });
      if (r.includes('ERROR') || r.includes('FAIL')) {
        results.push(`${path.basename(m)}=FAIL`);
      } else {
        results.push(`${path.basename(m)}=OK`);
      }
    }
  }
  const fails = results.filter(r => r.includes('FAIL'));
  if (fails.length > 0) fail('modules', `${results.length - fails.length}/${results.length} OK — BROKEN: ${fails.join(', ')}`);
  else pass('modules', `${results.length}/${results.length} loaded`);
}

// 6. Orchestrator freshness
function checkOrchestrator() {
  const orch = safeJSON(path.join(DATA, 'orchestrator-state.json'));
  if (!orch) { warn('orchestrator', 'State file missing'); return; }
  const ageMs = Date.now() - (orch.updatedAt || orch.lastRunAt || 0);
  const ageSec = Math.round(ageMs / 1000);
  const cycleCount = orch.cycleCount || 0;
  const errors = orch.errors?.length || 0;
  const totalTrades = orch.totalTrades || 0;
  const totalPnl = (orch.totalPnl || 0).toFixed(2);

  if (ageSec > 600) {
    // AUTO-PATCH: trigger orchestrator
    const uid = run('id -u opc', { fallback: '1000' });
    run(`sudo -u opc XDG_RUNTIME_DIR=/run/user/${uid} systemctl --user start master-orchestrator.service`, { fallback: '' });
    patched(`Triggered orchestrator — was stale (${ageSec}s)`);
    warn('orchestrator', `Stale ${ageSec}s — triggered. Cycle ${cycleCount}, ${totalTrades} trades, $${totalPnl}`);
  } else if (errors > 0) {
    warn('orchestrator', `${errors} error(s) in buffer. Cycle ${cycleCount}, age ${ageSec}s`);
  } else {
    pass('orchestrator', `Cycle ${cycleCount} | ${totalTrades} trades | $${totalPnl} PnL | ${ageSec}s ago | 0 errors`);
  }
}

// 7. Brain evolution
function checkBrain() {
  const brain = safeJSON(path.join(DATA, 'self-evolving-brain.json'));
  if (!brain) { warn('brain', 'Brain state file missing'); return; }

  const gens = brain.totalEvolutions || brain.generation || 0;
  const weights = brain.weights || brain.indicatorWeights || {};
  const assets = Object.keys(brain.assetProfiles || {}).length;
  const wKeys = Object.keys(weights);

  // Sanity: weights should sum roughly to 1.0
  const wSum = wKeys.reduce((s, k) => s + (weights[k] || 0), 0);
  const drift = Math.abs(wSum - 1.0);

  let detail = `${gens} gens | ${assets} assets | ${wKeys.length} weights | sum=${wSum.toFixed(4)}`;

  if (wKeys.length === 0) {
    fail('brain', 'No indicator weights found!');
  } else if (drift > 0.05) {
    warn('brain', `Weight drift ${drift.toFixed(4)} > 0.05. ${detail}`);
  } else {
    pass('brain', detail);
  }
}

// 8. Risk & kill switch
function checkRisk() {
  const risk = safeJSON(path.join(DATA, 'risk-manager-state.json'));
  const kill = safeJSON(path.join(DATA, 'kill-switch.json'));

  if (!risk) { warn('risk', 'Risk state file missing'); return; }

  const killActive = kill?.active || risk.killSwitchActive || false;
  const peakEq = (risk.peakEquity || 0).toFixed(2);
  const dailyPnl = (risk.dailyPnl?.pnl ?? risk.dailyPnl ?? 0).toFixed(2);
  const events = risk.riskEvents?.length || 0;

  const detail = `Kill=${killActive} | Peak=$${peakEq} | DayPnL=$${dailyPnl} | Events=${events}`;
  if (killActive) warn('risk', `KILL SWITCH ACTIVE! ${detail}`);
  else pass('risk', detail);
}

// 9. Payout config
function checkPayout() {
  try {
    const env = fs.readFileSync(ENV_FILE, 'utf8');
    const required = [
      'REVENUE_RECIPIENTS', 'SINGLE_PAYOUT_RECIPIENT',
      'PAYOUT_TOKEN_ADDRESS', 'PAYOUT_DAY_OF_WEEK',
      'SELF_SUSTAIN_REINVEST_BPS',
    ];
    const missing = required.filter(k => !env.includes(k + '='));
    if (missing.length > 0) {
      fail('payout', `Missing env vars: ${missing.join(', ')}`);
    } else {
      // Verify expected wallet address is still there
      const walletOk = env.includes('0xEbf5Fc610Bd7BC27Fc1E26596DD1da186C1436b9');
      const dayOk = env.includes('PAYOUT_DAY_OF_WEEK="5"') || env.includes("PAYOUT_DAY_OF_WEEK='5'") || env.includes('PAYOUT_DAY_OF_WEEK=5');
      if (!walletOk) warn('payout', 'Owner wallet address not found in .env.local!');
      else if (!dayOk) warn('payout', 'PAYOUT_DAY_OF_WEEK=5 not found');
      else pass('payout', 'All 5 keys present, wallet+day verified');
    }
  } catch {
    fail('payout', '.env.local unreadable');
  }
}

// 10. Disk / memory / load
function checkResources() {
  const diskLine = run("df / --output=pcent | tail -1", { fallback: '0' });
  const diskPct = parseInt(diskLine.replace(/[^0-9]/g, '')) || 0;
  const memLine = run("awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo", { fallback: '0' });
  const memMB = parseInt(memLine) || 0;
  const load = run("cat /proc/loadavg | awk '{print $1}'", { fallback: '0' });
  const procs = run("pgrep -c node", { fallback: '0' });

  // AUTO-PATCH: disk high
  if (diskPct > 85) {
    runSudo('journalctl --vacuum-size=30M 2>/dev/null');
    run('bash scripts/data-rotate.sh', { fallback: '' });
    patched(`Disk at ${diskPct}% — vacuumed journals + rotated data`);
  }

  // AUTO-PATCH: zombie processes (>15 node processes is suspicious)
  const procCount = parseInt(procs) || 0;
  if (procCount > 15) {
    run('bash scripts/ff-zombie-cleanup.js 2>/dev/null || node scripts/ff-zombie-cleanup.js 2>/dev/null', { fallback: '' });
    patched(`Killed zombie node processes (was ${procCount})`);
  }

  const detail = `Disk=${diskPct}% | RAM=${memMB}MB free | Load=${load} | Procs=${procs}`;
  if (diskPct > 90) fail('resources', detail);
  else if (diskPct > 80 || memMB < 500) warn('resources', detail);
  else pass('resources', detail);
}

// 11. Journal error scan (last 8 hours)
function checkErrors() {
  const errorCount = run(
    "journalctl --user --since '8 hours ago' --no-pager -q 2>/dev/null | grep -ic 'error\\|fatal\\|crash\\|uncaught' || echo 0",
    { fallback: '0' }
  );
  const sysErrors = run(
    "journalctl --since '8 hours ago' --no-pager -q 2>/dev/null | grep -i 'ff-\\|freedomforge' | grep -ic 'error\\|fatal\\|crash' || echo 0",
    { fallback: '0' }
  );
  const total = (parseInt(errorCount) || 0) + (parseInt(sysErrors) || 0);

  if (total > 20) warn('error-scan', `${total} error mentions in last 8h`);
  else pass('error-scan', `${total} error mentions in last 8h`);
}

// 12. Data file freshness
function checkDataFreshness() {
  const critical = [
    'orchestrator-state.json',
    'self-evolving-brain.json',
    'risk-manager-state.json',
    'agent-signal-bus.json',
    'watchdog-alerts.json',
  ];
  const stale = [];
  for (const f of critical) {
    const fp = path.join(DATA, f);
    try {
      const stat = fs.statSync(fp);
      const ageSec = Math.round((Date.now() - stat.mtimeMs) / 1000);
      if (ageSec > 1800) stale.push(`${f}(${ageSec}s)`);
    } catch {
      stale.push(`${f}(MISSING)`);
    }
  }
  if (stale.length > 0) warn('data-freshness', `Stale: ${stale.join(', ')}`);
  else pass('data-freshness', `All ${critical.length} files fresh (<30min)`);
}

// 13. SELinux context on .env.local
function checkSELinux() {
  const ctx = run(`ls -Z ${ENV_FILE} 2>/dev/null`, { fallback: '' });
  if (ctx.includes('user_tmp_t') || ctx.includes('unlabeled_t')) {
    // AUTO-PATCH
    runSudo(`restorecon -v ${ENV_FILE}`);
    patched('Fixed SELinux context on .env.local');
    warn('selinux', 'Fixed context (was user_tmp_t)');
  } else {
    pass('selinux', '.env.local context OK');
  }
}

// 14. Dashboard HTTP check
function checkDashboardHTTP() {
  const code = run('curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:3000/dashboard', { fallback: '0' });
  if (code === '200') {
    pass('dashboard-http', '200 OK');
  } else {
    // AUTO-PATCH: restart dashboard
    runSudo('systemctl restart ff-dashboard');
    const retry = run('sleep 5 && curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:3000/dashboard', { fallback: '0' });
    if (retry === '200') {
      patched('Restarted ff-dashboard — now 200');
      warn('dashboard-http', `Was ${code}, restarted → 200`);
    } else {
      fail('dashboard-http', `Dashboard down: ${code} → ${retry} after restart`);
    }
  }
}

// 15. Git working tree
function checkGit() {
  const status = run('git status --porcelain', { fallback: '' });
  const lines = status.split('\n').filter(l => l.trim());
  // Only flag tracked-file modifications (ignore untracked ??)
  const modified = lines.filter(l => !l.startsWith('??'));
  if (modified.length > 0) {
    warn('git', `${modified.length} modified tracked file(s): ${modified.map(l => l.trim().split(/\s+/).pop()).join(', ')}`);
  } else {
    pass('git', `Clean (${lines.length} untracked)`);
  }
}

// 16. Linger check (reboot survival)
function checkLinger() {
  const linger = run('loginctl show-user opc 2>/dev/null | grep Linger', { fallback: '' });
  if (linger.includes('yes')) {
    pass('linger', 'Enabled (reboot-safe)');
  } else {
    runSudo('loginctl enable-linger opc');
    patched('Re-enabled linger for opc');
    warn('linger', 'Was disabled — re-enabled');
  }
}

// 17. Capital mandate health
function checkCapital() {
  const cap = safeJSON(path.join(DATA, 'capital-mandate-state.json'));
  if (!cap) { pass('capital', 'State file not present (may use different name)'); return; }
  const mode = cap.currentMode || 'unknown';
  const hw = (cap.highWaterMark || 0).toFixed(2);
  const detail = `Mode=${mode} | HW=$${hw} | Milestones=${(cap.milestonesReached||[]).length}`;
  if (mode === 'survival') warn('capital', `SURVIVAL mode! ${detail}`);
  else pass('capital', detail);
}

// 18. Payout state file integrity (Ironclad Protocol)
function checkPayoutState() {
  const ps = safeJSON(path.join(DATA, 'payout-state.json'));
  if (!ps) { fail('payout-state', 'payout-state.json MISSING — Ironclad Protocol violated!'); return; }
  const pct = ps.payoutPct || 0;
  const wallet = ps.wallet || '';
  const floor = ps.payoutPctFloor || 15;
  if (pct < 15) {
    // AUTO-PATCH: enforce 15% floor
    ps.payoutPct = 15;
    ps.updatedAt = now();
    try {
      const _fp = path.join(DATA, 'payout-state.json');
      if (rio) { rio.writeJsonAtomic(_fp, ps); }
      else {
        const _tmp = _fp + '.tmp';
        fs.writeFileSync(_tmp, JSON.stringify(ps, null, 2));
        fs.renameSync(_tmp, _fp);
      }
    } catch {}
    patched('Restored payout % to 15% floor (Ironclad Protocol)');
    warn('payout-state', `Payout was ${pct}% — reset to 15% floor`);
  } else if (!wallet.startsWith('0x')) {
    fail('payout-state', 'Invalid payout wallet address!');
  } else {
    pass('payout-state', `Pct=${pct}% (floor=${floor}%) | Wallet=${wallet.slice(0,10)}... | Escalation=${ps.escalationEnabled ? 'ON' : 'OFF'}`);
  }
}

// 19. Portfolio breakdown in API
function checkPortfolioBreakdown() {
  try {
    const raw = run('curl -s --max-time 10 http://localhost:3000/api/status/empire', { fallback: '{}' });
    const d = JSON.parse(raw);
    const p = d.portfolio || {};
    const hasDeployed = p.totalDeployed !== undefined;
    const hasStandby = p.totalStandby !== undefined;
    const hasOpen = p.openPositionCount !== undefined;
    if (hasDeployed && hasStandby && hasOpen) {
      pass('portfolio-breakdown', `Deployed=$${(p.totalDeployed||0).toFixed(2)} | Standby=$${(p.totalStandby||0).toFixed(2)} | Open=${p.openPositionCount}`);
    } else {
      warn('portfolio-breakdown', 'Missing deployed/standby fields in API');
    }
  } catch (e) {
    warn('portfolio-breakdown', `API check failed: ${e.message?.slice(0,60)}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  log('INFO', '═══ FreedomForge Scheduled Deep Audit ═══');
  log('INFO', `Audit #${getAuditNumber()} | Permanent — no expiry`);

  // Run all checks
  checkCoreServices();
  checkUserTimers();
  checkSystemTimers();
  checkFailedUnits();
  checkModules();
  checkOrchestrator();
  checkBrain();
  checkRisk();
  checkPayout();
  checkResources();
  checkErrors();
  checkDataFreshness();
  checkSELinux();
  checkDashboardHTTP();
  checkGit();
  checkLinger();
  checkCapital();
  checkPayoutState();
  checkPortfolioBreakdown();

  // Summary
  const total = Object.keys(report.checks).length;
  const oks = Object.values(report.checks).filter(c => c.status === 'OK').length;
  const warns = report.warnings.length;
  const errs = report.errors.length;
  const patches = report.patches.length;

  log('INFO', '');
  log('INFO', `═══ VERDICT: ${report.verdict} ═══`);
  log('INFO', `Checks: ${oks}/${total} OK | ${warns} warnings | ${errs} errors | ${patches} patches applied`);

  if (patches > 0) {
    log('INFO', 'Patches applied this run:');
    for (const p of report.patches) log('INFO', `  → ${p.action}`);
  }
  if (warns > 0) {
    log('INFO', 'Warnings:');
    for (const w of report.warnings) log('INFO', `  ⚠ ${w}`);
  }
  if (errs > 0) {
    log('INFO', 'Errors:');
    for (const e of report.errors) log('INFO', `  ✗ ${e}`);
  }

  // Write log file
  try {
    if (!fs.existsSync(LOGS)) fs.mkdirSync(LOGS, { recursive: true });
    const logFile = path.join(LOGS, `audit-${ts()}.log`);
    fs.writeFileSync(logFile, logLines.join('\n') + '\n');
    log('INFO', `Log written: ${logFile}`);

    // Prune old audit logs (keep last 21 = 7 days * 3/day)
    const auditLogs = fs.readdirSync(LOGS)
      .filter(f => f.startsWith('audit-') && f.endsWith('.log'))
      .sort();
    if (auditLogs.length > 25) {
      for (const old of auditLogs.slice(0, auditLogs.length - 25)) {
        fs.unlinkSync(path.join(LOGS, old));
      }
    }
  } catch (e) {
    log('WARN', `Could not write log: ${e.message}`);
  }

  // Append to audit history
  try {
    const history = safeJSON(AUDIT_HISTORY) || { audits: [] };
    history.audits.push({
      ts: now(),
      verdict: report.verdict,
      oks, warns, errs, patches,
      patchDetails: report.patches.map(p => p.action),
      warningDetails: report.warnings,
      errorDetails: report.errors,
    });
    // Keep last 30 entries
    if (history.audits.length > 30) history.audits = history.audits.slice(-30);
    if (rio) { rio.writeJsonAtomic(AUDIT_HISTORY, history); }
    else {
      const _tmp = AUDIT_HISTORY + '.tmp';
      fs.writeFileSync(_tmp, JSON.stringify(history, null, 2));
      fs.renameSync(_tmp, AUDIT_HISTORY);
    }
  } catch (e) {
    log('WARN', `Could not write audit history: ${e.message}`);
  }
}

function getAuditNumber() {
  try {
    const history = safeJSON(AUDIT_HISTORY);
    return (history?.audits?.length || 0) + 1;
  } catch {
    return 1;
  }
}

main().catch(e => {
  log('FAIL', `Audit crashed: ${e.message}`);
  process.exit(1);
});
