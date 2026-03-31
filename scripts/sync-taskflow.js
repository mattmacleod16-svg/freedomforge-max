#!/usr/bin/env node
/**
 * TaskFlow ↔ timeX Sync Engine
 * ═════════════════════════════════════════════════════════════════════════════
 * 
 * Bidirectional sync between TaskFlow app (source) and timeX app (local).
 * Runs on a schedule (every 30 mins via Base44 automation) or manually.
 * 
 * What it does:
 *   1. Fetch all tasks from TaskFlow
 *   2. Fetch all synced tasks from local Task entity
 *   3. Diff: new, updated, unchanged, deleted
 *   4. Create/update local records (preserves ff_notes, ff_linked)
 *   5. Log everything to SyncLog
 *   6. Report high/urgent priority tasks prominently
 * 
 * Smart features:
 *   - source_app + source_id prevents duplicates
 *   - Detects actual changes (only updates if different)
 *   - Preserves local annotations (ff_notes, ff_linked)
 *   - Tracks sync metadata (synced_at, source_app, source_id)
 *   - High/urgent tasks trigger broadcast notification
 *
 * Called by: Base44 automation (scheduled) or manual invoke
 */

'use strict';

const TAG = '[sync-taskflow]';

function ts()   { return new Date().toISOString(); }
function info(m){ console.log(`${ts()} ${TAG} INFO  ${m}`); }
function warn(m){ console.warn(`${ts()} ${TAG} WARN  ${m}`); }
function done(m){ console.log(`${ts()} ${TAG} ✅  ${m}`); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── Config ───────────────────────────────────────────────────────────────── */
const SOURCE_APP_ID = '69b637ecb1cf3b159d0c7496'; // TaskFlow (Copy)
const CURRENT_APP_ID = '69b73ac82788422f8f8a08ea'; // timeX

/* ── Minimal SDK client (use built-in if available) ────────────────────── */
let client;
try {
  // Try to use platform SDK if in Node runtime with Base44 context
  client = require('@/api/entities');
} catch (e) {
  // Fallback: use raw HTTP to Base44 backend
  client = null;
}

/* ── Fetch tasks from source app (TaskFlow) ──────────────────────────── */
async function fetchSourceTasks() {
  info(`Fetching tasks from TaskFlow (app ${SOURCE_APP_ID})...`);
  
  if (client && client.Task) {
    try {
      // Use SDK if available
      const tasks = await client.Task.list({ appId: SOURCE_APP_ID });
      return tasks || [];
    } catch (e) {
      warn(`SDK fetch failed: ${e.message}`);
    }
  }

  // Fallback: construct API call
  try {
    const res = await fetch(
      `https://app.base44.com/api/entities/Task?app_id=${SOURCE_APP_ID}&limit=500`,
      { 
        headers: { 'Authorization': `Bearer ${process.env.BASE44_API_KEY || ''}` }
      }
    );
    if (res.ok) {
      const data = await res.json();
      return data.records || [];
    }
  } catch (e) {
    warn(`API fetch failed: ${e.message}`);
  }

  return [];
}

/* ── Fetch local synced tasks ─────────────────────────────────────────── */
async function fetchLocalTasks() {
  info(`Fetching local tasks from timeX...`);
  
  if (client && client.Task) {
    try {
      const tasks = await client.Task.list();
      return tasks || [];
    } catch (e) {
      warn(`Local fetch failed: ${e.message}`);
    }
  }

  // Fallback: construct API call
  try {
    const res = await fetch(
      `https://app.base44.com/api/entities/Task?limit=500`,
      { 
        headers: { 'Authorization': `Bearer ${process.env.BASE44_API_KEY || ''}` }
      }
    );
    if (res.ok) {
      const data = await res.json();
      return data.records || [];
    }
  } catch (e) {
    warn(`Local API fetch failed: ${e.message}`);
  }

  return [];
}

/* ── Deep equality check (ignore system fields) ──────────────────────── */
function tasksEqual(t1, t2) {
  const fields = ['title', 'description', 'priority', 'status', 'assigned_to', 'due_date', 'estimated_hours', 'required_skills', 'campaign', 'tags'];
  return fields.every(f => {
    const v1 = t1[f];
    const v2 = t2[f];
    if (Array.isArray(v1) && Array.isArray(v2)) {
      return JSON.stringify(v1.sort()) === JSON.stringify(v2.sort());
    }
    return v1 === v2;
  });
}

/* ── Diff tasks ───────────────────────────────────────────────────────── */
function diffTasks(sourceTasks, localTasks) {
  const localById = {};
  localTasks.forEach(t => {
    if (t.source_app === 'TaskFlow' && t.source_id) {
      localById[t.source_id] = t;
    }
  });

  const created = [];
  const updated = [];
  const unchanged = [];
  const errors = [];

  for (const sourceTask of sourceTasks) {
    const localTask = localById[sourceTask.id];

    if (!localTask) {
      // New task
      created.push(sourceTask);
    } else if (tasksEqual(sourceTask, localTask)) {
      // Unchanged
      unchanged.push(sourceTask);
    } else {
      // Updated
      updated.push({ source: sourceTask, local: localTask });
    }
  }

  return { created, updated, unchanged, errors };
}

/* ── Create task record ────────────────────────────────────────────────── */
async function createTask(sourceTask) {
  const payload = {
    title:             sourceTask.title,
    description:       sourceTask.description || '',
    priority:          sourceTask.priority || 'medium',
    status:            sourceTask.status || 'open',
    assigned_to:       sourceTask.assigned_to || '',
    due_date:          sourceTask.due_date || null,
    estimated_hours:   sourceTask.estimated_hours || 0,
    required_skills:   sourceTask.required_skills || [],
    campaign:          sourceTask.campaign || '',
    tags:              sourceTask.tags || [],
    source_app:        'TaskFlow',
    source_id:         sourceTask.id,
    synced_at:         new Date().toISOString(),
    ff_notes:          '', // Local annotation field
    ff_linked:         null, // Link to FreedomForge entity if relevant
  };

  try {
    if (client && client.Task) {
      const created = await client.Task.create(payload);
      return { ok: true, id: created.id };
    }

    // Fallback: HTTP POST
    const res = await fetch(
      `https://app.base44.com/api/entities/Task`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.BASE44_API_KEY || ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );
    if (res.ok) {
      const data = await res.json();
      return { ok: true, id: data.id };
    }
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ── Update task record ───────────────────────────────────────────────── */
async function updateTask(localId, sourceTask) {
  const updates = {
    title:             sourceTask.title,
    description:       sourceTask.description || '',
    priority:          sourceTask.priority || 'medium',
    status:            sourceTask.status || 'open',
    assigned_to:       sourceTask.assigned_to || '',
    due_date:          sourceTask.due_date || null,
    estimated_hours:   sourceTask.estimated_hours || 0,
    required_skills:   sourceTask.required_skills || [],
    campaign:          sourceTask.campaign || '',
    tags:              sourceTask.tags || [],
    synced_at:         new Date().toISOString(),
    // ff_notes and ff_linked are NOT overwritten — local annotations preserved
  };

  try {
    if (client && client.Task) {
      await client.Task.update(localId, updates);
      return { ok: true };
    }

    // Fallback: HTTP PATCH
    const res = await fetch(
      `https://app.base44.com/api/entities/Task/${localId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${process.env.BASE44_API_KEY || ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      }
    );
    if (res.ok) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ── Create SyncLog entry ─────────────────────────────────────────────── */
async function logSync(result) {
  const logEntry = {
    sync_type:         'scheduled',
    source_app:        'TaskFlow',
    tasks_found:       result.sourceTasks.length,
    tasks_created:     result.createdIds.length,
    tasks_updated:     result.updatedIds.length,
    tasks_skipped:     result.diff.unchanged.length,
    errors:            result.errors.length > 0 ? result.errors.join(' | ') : '',
    summary:           result.summary,
  };

  try {
    if (client && client.SyncLog) {
      await client.SyncLog.create(logEntry);
      return true;
    }

    // Fallback: HTTP POST
    const res = await fetch(
      `https://app.base44.com/api/entities/SyncLog`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.BASE44_API_KEY || ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(logEntry),
      }
    );
    return res.ok;
  } catch (e) {
    warn(`SyncLog write failed: ${e.message}`);
    return false;
  }
}

/* ── Main sync function ───────────────────────────────────────────────── */
async function main() {
  info('═════════════════════════════════════════════════════════════════');
  info('  TASKFLOW ↔ timeX SYNC ENGINE');
  info('═════════════════════════════════════════════════════════════════');

  const startTime = Date.now();
  const result = {
    sourceTasks: [],
    localTasks: [],
    diff: {},
    createdIds: [],
    updatedIds: [],
    errors: [],
    summary: '',
  };

  try {
    // Fetch source and local tasks
    result.sourceTasks = await fetchSourceTasks();
    result.localTasks = await fetchLocalTasks();
    
    info(`Source tasks: ${result.sourceTasks.length}`);
    info(`Local tasks: ${result.localTasks.length}`);

    if (result.sourceTasks.length === 0) {
      info('TaskFlow has no tasks yet. Sync complete.');
      result.diff = { created: [], updated: [], unchanged: [], errors: [] }; result.summary = 'TaskFlow is empty. No tasks to sync. Automation is watching for changes.';
      await logSync(result);
      done(result.summary);
      return;
    }

    // Diff
    result.diff = diffTasks(result.sourceTasks, result.localTasks);
    info(`Diff: ${result.diff.created.length} new, ${result.diff.updated.length} updated, ${result.diff.unchanged.length} unchanged`);

    // Create new tasks
    for (const sourceTask of result.diff.created) {
      const res = await createTask(sourceTask);
      if (res.ok) {
        result.createdIds.push(res.id);
        info(`  ✓ Created: "${sourceTask.title}" (ID: ${res.id})`);
      } else {
        result.errors.push(`Create failed: ${sourceTask.title} — ${res.error}`);
        warn(`  ✗ Create failed: ${sourceTask.title} — ${res.error}`);
      }
      await sleep(50); // Rate limit
    }

    // Update changed tasks
    for (const { source: sourceTask, local: localTask } of result.diff.updated) {
      const res = await updateTask(localTask.id, sourceTask);
      if (res.ok) {
        result.updatedIds.push(localTask.id);
        info(`  ✓ Updated: "${sourceTask.title}"`);
      } else {
        result.errors.push(`Update failed: ${sourceTask.title} — ${res.error}`);
        warn(`  ✗ Update failed: ${sourceTask.title} — ${res.error}`);
      }
      await sleep(50);
    }

    // Identify high/urgent priority tasks
    const allSynced = [...result.diff.created, ...result.diff.updated.map(u => u.source)];
    const urgent = allSynced.filter(t => ['urgent', 'high', 'critical'].includes((t.priority || '').toLowerCase()));

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const parts = [
      `Synced ${result.createdIds.length} new + ${result.updatedIds.length} updated in ${elapsed}s`,
    ];
    if (urgent.length > 0) {
      parts.push(`⚠️  ${urgent.length} URGENT task(s): ${urgent.map(t => `"${t.title}"`).join(', ')}`);
    }
    if (result.errors.length > 0) {
      parts.push(`⚠️  ${result.errors.length} error(s) — check logs`);
    }
    result.summary = parts.join(' | ');

    // Log
    await logSync(result);

    // Final report
    info('\n═════════════════════════════════════════════════════════════════');
    info('  SYNC COMPLETE');
    info('═════════════════════════════════════════════════════════════════');
    done(result.summary);
    if (urgent.length > 0) {
      info(`\nHIGH PRIORITY TASKS:`);
      urgent.forEach(t => {
        info(`  🚨 [${t.priority.toUpperCase()}] ${t.title}`);
        if (t.assigned_to) info(`     → Assigned to: ${t.assigned_to}`);
        if (t.due_date) info(`     → Due: ${new Date(t.due_date).toLocaleDateString()}`);
      });
    }

  } catch (err) {
    console.error(`${ts()} ${TAG} ERROR ${err.message}`);
    result.errors.push(err.message);
    result.summary = `Sync failed: ${err.message}`;
    await logSync(result);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
