#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(REPO_ROOT, 'data');
const LOGS_DIR = path.join(REPO_ROOT, 'logs');

const KEEP_BAK_COUNT = Number(process.env.UNISON_KEEP_BAK_COUNT || 2);
const KEEP_EVENTS_LINES = Number(process.env.UNISON_KEEP_EVENT_LINES || 5000);

function listFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function removeFile(filePath, apply, actions) {
  const rel = path.relative(REPO_ROOT, filePath);
  if (apply) {
    fs.rmSync(filePath, { force: true });
  }
  actions.push(`${apply ? 'removed' : 'would-remove'} ${rel}`);
}

function cleanOldBackups(apply, actions) {
  const files = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR) : [];
  const bakGroups = new Map();

  for (const name of files) {
    const match = name.match(/^(.*\.json)\.bak\.(\d+)$/);
    if (!match) continue;
    const base = match[1];
    const index = Number(match[2]);
    if (!bakGroups.has(base)) bakGroups.set(base, []);
    bakGroups.get(base).push({ name, index });
  }

  for (const [base, backups] of bakGroups.entries()) {
    backups.sort((a, b) => a.index - b.index);
    const toRemove = backups.slice(KEEP_BAK_COUNT);
    for (const item of toRemove) {
      removeFile(path.join(DATA_DIR, item.name), apply, actions);
    }
    if (backups.length > KEEP_BAK_COUNT) {
      actions.push(`${apply ? 'kept' : 'would-keep'} latest ${KEEP_BAK_COUNT} backup(s) for ${base}`);
    }
  }
}

function cleanZeroByteFiles(apply, actions) {
  const files = [...listFilesRecursive(DATA_DIR), ...listFilesRecursive(LOGS_DIR)];
  for (const filePath of files) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size === 0) {
        removeFile(filePath, apply, actions);
      }
    } catch {
      // Ignore transient file errors.
    }
  }
}

function trimEventsLog(apply, actions) {
  const eventsFile = path.join(DATA_DIR, 'events.log');
  if (!fs.existsSync(eventsFile)) return;

  const content = fs.readFileSync(eventsFile, 'utf8');
  const lines = content.split('\n');
  if (lines.length <= KEEP_EVENTS_LINES) return;

  const trimmed = lines.slice(-KEEP_EVENTS_LINES).join('\n');
  if (apply) {
    fs.writeFileSync(eventsFile, trimmed, 'utf8');
  }
  actions.push(`${apply ? 'trimmed' : 'would-trim'} data/events.log to last ${KEEP_EVENTS_LINES} lines`);
}

function runCleanup(options) {
  const apply = Boolean(options.apply);
  const actions = [];

  cleanOldBackups(apply, actions);
  cleanZeroByteFiles(apply, actions);
  trimEventsLog(apply, actions);

  return {
    mode: apply ? 'apply' : 'dry-run',
    actionCount: actions.length,
    actions,
  };
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  const json = process.argv.includes('--json');
  const result = runCleanup({ apply });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Unison stale-data cleanup (${result.mode})`);
    console.log(`Actions: ${result.actionCount}`);
    for (const action of result.actions) console.log(`- ${action}`);
  }
}

module.exports = {
  runCleanup,
};
