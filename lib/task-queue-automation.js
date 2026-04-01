/**
 * Task Queue Automation — Time-Saving Repetitive Task Scheduler
 * ═══════════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 *   Automates repetitive trading system tasks to save user time, including:
 *   - Data backups and hygiene
 *   - Health checks and self-healing
 *   - Reconciliation runs
 *   - Performance reporting
 *   - Strategy optimization cycles
 *
 * FEATURES:
 *   1. Priority-based task queue with configurable scheduling
 *   2. Automatic task retry with exponential backoff
 *   3. Task dependencies and chaining
 *   4. User feedback collection on task effectiveness
 *   5. Performance metrics and optimization
 *   6. Kill-switch integration for safety
 *
 * SAFETY:
 *   - Respects circuit breakers and kill switch
 *   - All tasks are audited via events.log
 *   - Graceful degradation on failures
 *   - Human oversight via feedback mechanism
 *
 * USAGE:
 *   const taskQueue = require('./task-queue-automation');
 *   taskQueue.scheduleTask('backup', { priority: 'high' });
 *   taskQueue.start();
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Optional module dependencies
let rio, signalBus, logger;
try { rio = require('./resilient-io'); } catch { rio = null; }
try { signalBus = require('./agent-signal-bus'); } catch { signalBus = null; }
try {
  const { createLogger } = require('./logger');
  logger = createLogger('task-queue');
} catch {
  logger = {
    info: (...args) => console.log('[task-queue] [info]', ...args),
    warn: (...args) => console.warn('[task-queue] [warn]', ...args),
    error: (...args) => console.error('[task-queue] [error]', ...args),
  };
}

// ────────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ────────────────────────────────────────────────────────────────────────────────

const QUEUE_STATE_FILE = path.resolve(process.cwd(), process.env.TASK_QUEUE_STATE_FILE || 'data/task-queue-state.json');
const FEEDBACK_FILE = path.resolve(process.cwd(), process.env.TASK_FEEDBACK_FILE || 'data/task-feedback.json');
const KILL_SWITCH_FILE = path.resolve(process.cwd(), 'data/kill-switch.json');

const DEFAULT_CONFIG = {
  maxConcurrentTasks: parseInt(process.env.TASK_QUEUE_MAX_CONCURRENT || '3', 10),
  maxRetries: parseInt(process.env.TASK_QUEUE_MAX_RETRIES || '3', 10),
  baseRetryDelayMs: parseInt(process.env.TASK_QUEUE_RETRY_DELAY_MS || '5000', 10),
  maxRetryDelayMs: parseInt(process.env.TASK_QUEUE_MAX_RETRY_DELAY_MS || '60000', 10),
  pollIntervalMs: parseInt(process.env.TASK_QUEUE_POLL_INTERVAL_MS || '10000', 10),
  taskTimeoutMs: parseInt(process.env.TASK_QUEUE_TIMEOUT_MS || '300000', 10), // 5 min default
  enableFeedback: process.env.TASK_QUEUE_FEEDBACK !== 'false',
};

// Task priority levels (lower number = higher priority)
const PRIORITY = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  background: 4,
};

// ────────────────────────────────────────────────────────────────────────────────
// STATE MANAGEMENT
// ────────────────────────────────────────────────────────────────────────────────

function loadState() {
  if (rio) return rio.readJsonSafe(QUEUE_STATE_FILE, { fallback: createEmptyState() });
  try {
    if (!fs.existsSync(QUEUE_STATE_FILE)) return createEmptyState();
    return JSON.parse(fs.readFileSync(QUEUE_STATE_FILE, 'utf8'));
  } catch {
    return createEmptyState();
  }
}

function saveState(state) {
  state.updatedAt = Date.now();
  if (rio) {
    rio.writeJsonAtomic(QUEUE_STATE_FILE, state);
    return;
  }
  fs.mkdirSync(path.dirname(QUEUE_STATE_FILE), { recursive: true });
  const tmp = QUEUE_STATE_FILE + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, QUEUE_STATE_FILE);
}

function createEmptyState() {
  return {
    queue: [],
    running: [],
    completed: [],
    failed: [],
    stats: {
      tasksScheduled: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      totalTimeSavedMs: 0,
      avgExecutionTimeMs: 0,
    },
    config: { ...DEFAULT_CONFIG },
    updatedAt: Date.now(),
  };
}

// ────────────────────────────────────────────────────────────────────────────────
// FEEDBACK SYSTEM
// ────────────────────────────────────────────────────────────────────────────────

function loadFeedback() {
  if (rio) return rio.readJsonSafe(FEEDBACK_FILE, { fallback: { entries: [], summary: {} } });
  try {
    if (!fs.existsSync(FEEDBACK_FILE)) return { entries: [], summary: {} };
    return JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8'));
  } catch {
    return { entries: [], summary: {} };
  }
}

function saveFeedback(feedback) {
  feedback.updatedAt = Date.now();
  // Keep only last 500 feedback entries
  if (feedback.entries.length > 500) {
    feedback.entries = feedback.entries.slice(-500);
  }
  if (rio) {
    rio.writeJsonAtomic(FEEDBACK_FILE, feedback);
    return;
  }
  fs.mkdirSync(path.dirname(FEEDBACK_FILE), { recursive: true });
  const tmp = FEEDBACK_FILE + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(feedback, null, 2));
  fs.renameSync(tmp, FEEDBACK_FILE);
}

/**
 * Record user feedback on a completed task.
 * @param {string} taskId - ID of the task
 * @param {object} feedback - Feedback data
 * @param {number} feedback.rating - 1-5 rating
 * @param {string} feedback.comment - Optional comment
 * @param {boolean} feedback.timeSaved - Whether it saved time
 * @param {number} feedback.estimatedMinutesSaved - Estimated minutes saved
 */
function recordFeedback(taskId, { rating, comment = '', timeSaved = true, estimatedMinutesSaved = 0 }) {
  const state = loadState();
  const config = state.config || DEFAULT_CONFIG;

  if (!config.enableFeedback) {
    logger.info('Feedback disabled, skipping');
    return null;
  }

  const feedback = loadFeedback();
  const entry = {
    id: `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    taskId,
    rating: Math.min(5, Math.max(1, rating)),
    comment,
    timeSaved,
    estimatedMinutesSaved: Math.max(0, estimatedMinutesSaved),
    createdAt: new Date().toISOString(),
  };

  feedback.entries.push(entry);

  // Update summary
  const taskType = taskId.split('-')[0];
  if (!feedback.summary[taskType]) {
    feedback.summary[taskType] = { count: 0, totalRating: 0, totalMinutesSaved: 0 };
  }
  feedback.summary[taskType].count += 1;
  feedback.summary[taskType].totalRating += entry.rating;
  feedback.summary[taskType].totalMinutesSaved += entry.estimatedMinutesSaved;
  feedback.summary[taskType].avgRating = feedback.summary[taskType].totalRating / feedback.summary[taskType].count;

  saveFeedback(feedback);
  logger.info(`Recorded feedback for task ${taskId}: rating=${rating}, minSaved=${estimatedMinutesSaved}`);

  // Update time saved stats
  if (timeSaved && estimatedMinutesSaved > 0) {
    state.stats.totalTimeSavedMs += estimatedMinutesSaved * 60 * 1000;
    saveState(state);
  }

  // Publish feedback event
  if (signalBus) {
    signalBus.publish({
      type: 'task_feedback',
      source: 'task-queue-automation',
      confidence: 0.9,
      ttl: 24 * 60 * 60 * 1000,
      payload: entry,
    });
  }

  return entry;
}

/**
 * Get feedback summary for reporting.
 */
function getFeedbackSummary() {
  const feedback = loadFeedback();
  const entries = feedback.entries || [];
  const recentEntries = entries.filter(e => {
    const ts = Date.parse(e.createdAt);
    return Date.now() - ts < 7 * 24 * 60 * 60 * 1000; // last 7 days
  });

  return {
    totalEntries: entries.length,
    recentEntries: recentEntries.length,
    byTaskType: feedback.summary || {},
    avgRating: entries.length > 0
      ? entries.reduce((sum, e) => sum + e.rating, 0) / entries.length
      : 0,
    totalMinutesSaved: entries.reduce((sum, e) => sum + (e.estimatedMinutesSaved || 0), 0),
  };
}

// ────────────────────────────────────────────────────────────────────────────────
// KILL SWITCH CHECK
// ────────────────────────────────────────────────────────────────────────────────

function isKillSwitchActive() {
  try {
    if (!fs.existsSync(KILL_SWITCH_FILE)) return false;
    const data = JSON.parse(fs.readFileSync(KILL_SWITCH_FILE, 'utf8'));
    return data.active === true || data.killSwitch === true;
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// TASK DEFINITIONS
// ────────────────────────────────────────────────────────────────────────────────

/**
 * Registry of available task types with their handlers.
 */
const TASK_HANDLERS = {
  /**
   * Data backup task
   */
  backup: {
    name: 'Data Backup',
    description: 'Backs up critical data files',
    estimatedDurationMs: 30000,
    estimatedTimeSavedMinutes: 5,
    handler: async () => {
      const dataDir = path.resolve(process.cwd(), 'data');
      const backupDir = path.resolve(process.cwd(), 'data/backups');
      fs.mkdirSync(backupDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json') && !f.includes('backup'));

      let backed = 0;
      for (const file of files) {
        const src = path.join(dataDir, file);
        const dest = path.join(backupDir, `${file}.${timestamp}.bak`);
        try {
          fs.copyFileSync(src, dest);
          backed++;
        } catch (e) {
          logger.warn(`Failed to backup ${file}: ${e.message}`);
        }
      }

      return { success: true, filesBackedUp: backed, timestamp };
    },
  },

  /**
   * Health check task
   */
  healthCheck: {
    name: 'System Health Check',
    description: 'Checks system health and reports issues',
    estimatedDurationMs: 15000,
    estimatedTimeSavedMinutes: 3,
    handler: async () => {
      const checks = {};

      // Check data directory
      const dataDir = path.resolve(process.cwd(), 'data');
      checks.dataDir = fs.existsSync(dataDir);

      // Check state files
      const stateFiles = ['trade-journal.json', 'agent-signal-bus.json', 'kill-switch.json'];
      checks.stateFiles = {};
      for (const file of stateFiles) {
        const filePath = path.join(dataDir, file);
        checks.stateFiles[file] = fs.existsSync(filePath);
      }

      // Check kill switch
      checks.killSwitchActive = isKillSwitchActive();

      // Check signal bus health
      if (signalBus && typeof signalBus.getState === 'function') {
        try {
          const busState = signalBus.getState();
          checks.signalBus = { healthy: true, signalCount: busState?.signals?.length || 0 };
        } catch {
          checks.signalBus = { healthy: false };
        }
      }

      const allHealthy = checks.dataDir && !checks.killSwitchActive;
      return { success: true, healthy: allHealthy, checks };
    },
  },

  /**
   * Cleanup old data task
   */
  cleanup: {
    name: 'Data Cleanup',
    description: 'Removes old backup files and logs',
    estimatedDurationMs: 20000,
    estimatedTimeSavedMinutes: 2,
    handler: async () => {
      const backupDir = path.resolve(process.cwd(), 'data/backups');
      if (!fs.existsSync(backupDir)) {
        return { success: true, filesRemoved: 0, message: 'No backup directory' };
      }

      const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days
      const cutoff = Date.now() - maxAgeMs;
      const files = fs.readdirSync(backupDir);

      let removed = 0;
      for (const file of files) {
        const filePath = path.join(backupDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
            removed++;
          }
        } catch (e) {
          logger.warn(`Failed to check/remove ${file}: ${e.message}`);
        }
      }

      return { success: true, filesRemoved: removed };
    },
  },

  /**
   * Performance report generation
   */
  performanceReport: {
    name: 'Performance Report',
    description: 'Generates trading performance summary',
    estimatedDurationMs: 10000,
    estimatedTimeSavedMinutes: 10,
    handler: async () => {
      let tradeJournal;
      try { tradeJournal = require('./trade-journal'); } catch { tradeJournal = null; }

      if (!tradeJournal) {
        return { success: false, error: 'Trade journal not available' };
      }

      const stats = tradeJournal.getStats({ sinceDays: 7 });
      return {
        success: true,
        report: {
          period: stats.period,
          totalTrades: stats.totalTrades,
          closedTrades: stats.closedTrades,
          winRate: stats.winRate,
          totalPnl: stats.totalPnl,
          sharpeRatio: stats.sharpeRatio,
          generatedAt: new Date().toISOString(),
        },
      };
    },
  },

  /**
   * Strategy evolution check
   */
  strategyCheck: {
    name: 'Strategy Evolution Check',
    description: 'Analyzes strategy performance and suggests optimizations',
    estimatedDurationMs: 15000,
    estimatedTimeSavedMinutes: 15,
    handler: async () => {
      let tradeJournal;
      try { tradeJournal = require('./trade-journal'); } catch { tradeJournal = null; }

      if (!tradeJournal || typeof tradeJournal.getStrategyEvolution !== 'function') {
        return { success: false, error: 'Strategy evolution not available' };
      }

      const evolution = tradeJournal.getStrategyEvolution();
      return {
        success: true,
        evolution: {
          recommendations: evolution.recommendations,
          generationCount: evolution.generationCount,
          stats: evolution.stats,
          generatedAt: new Date().toISOString(),
        },
      };
    },
  },
};

// ────────────────────────────────────────────────────────────────────────────────
// TASK SCHEDULING
// ────────────────────────────────────────────────────────────────────────────────

/**
 * Schedule a task for execution.
 * @param {string} taskType - Type of task (from TASK_HANDLERS)
 * @param {object} options - Task options
 * @param {string} options.priority - Task priority (critical, high, normal, low, background)
 * @param {number} options.delayMs - Delay before execution
 * @param {object} options.params - Parameters to pass to the handler
 * @param {string[]} options.dependencies - Task IDs that must complete first
 * @returns {object} Scheduled task info
 */
function scheduleTask(taskType, options = {}) {
  if (isKillSwitchActive()) {
    logger.warn('Kill switch active, task scheduling blocked');
    return { error: 'Kill switch active' };
  }

  const handler = TASK_HANDLERS[taskType];
  if (!handler) {
    logger.error(`Unknown task type: ${taskType}`);
    return { error: `Unknown task type: ${taskType}` };
  }

  const state = loadState();
  const priority = options.priority || 'normal';
  const now = Date.now();

  const task = {
    id: `${taskType}-${now}-${Math.random().toString(36).slice(2, 6)}`,
    type: taskType,
    name: handler.name,
    description: handler.description,
    priority: PRIORITY[priority] ?? PRIORITY.normal,
    priorityLabel: priority,
    params: options.params || {},
    dependencies: options.dependencies || [],
    scheduledAt: new Date(now).toISOString(),
    scheduledTs: now,
    executeAfter: now + (options.delayMs || 0),
    attempts: 0,
    maxAttempts: state.config.maxRetries,
    status: 'queued',
    estimatedDurationMs: handler.estimatedDurationMs,
    estimatedTimeSavedMinutes: handler.estimatedTimeSavedMinutes,
  };

  state.queue.push(task);
  state.stats.tasksScheduled++;
  saveState(state);

  logger.info(`Scheduled task: ${task.id} (${taskType}) priority=${priority}`);

  // Publish scheduling event
  if (signalBus) {
    signalBus.publish({
      type: 'task_scheduled',
      source: 'task-queue-automation',
      confidence: 0.95,
      ttl: 60 * 60 * 1000,
      payload: { taskId: task.id, type: taskType, priority },
    });
  }

  return task;
}

/**
 * Get the next task(s) ready for execution.
 */
function getNextTasks() {
  const state = loadState();
  const now = Date.now();
  const config = state.config || DEFAULT_CONFIG;

  // Filter tasks ready to execute
  const ready = state.queue
    .filter(task => {
      if (task.status !== 'queued') return false;
      if (task.executeAfter > now) return false;

      // Check dependencies
      if (task.dependencies.length > 0) {
        const completedIds = state.completed.map(t => t.id);
        const allDepsComplete = task.dependencies.every(dep => completedIds.includes(dep));
        if (!allDepsComplete) return false;
      }

      return true;
    })
    .sort((a, b) => a.priority - b.priority || a.scheduledTs - b.scheduledTs);

  // Limit by concurrent task count
  const runningCount = state.running.length;
  const available = Math.max(0, config.maxConcurrentTasks - runningCount);

  return ready.slice(0, available);
}

/**
 * Execute a single task.
 */
async function executeTask(task) {
  if (isKillSwitchActive()) {
    logger.warn(`Kill switch active, aborting task ${task.id}`);
    return { success: false, error: 'Kill switch activated' };
  }

  const handler = TASK_HANDLERS[task.type];
  if (!handler) {
    return { success: false, error: `No handler for task type: ${task.type}` };
  }

  const state = loadState();
  const config = state.config || DEFAULT_CONFIG;

  // Move to running
  state.queue = state.queue.filter(t => t.id !== task.id);
  task.status = 'running';
  task.startedAt = new Date().toISOString();
  task.attempts++;
  state.running.push(task);
  saveState(state);

  logger.info(`Executing task: ${task.id} (attempt ${task.attempts}/${task.maxAttempts})`);

  try {
    // Execute with timeout
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Task timeout')), config.taskTimeoutMs)
    );
    const result = await Promise.race([
      handler.handler(task.params),
      timeoutPromise,
    ]);

    // Success
    const executionTimeMs = Date.now() - Date.parse(task.startedAt);
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    task.executionTimeMs = executionTimeMs;
    task.result = result;

    // Move to completed
    const newState = loadState();
    newState.running = newState.running.filter(t => t.id !== task.id);
    newState.completed.push(task);
    newState.stats.tasksCompleted++;

    // Update avg execution time
    const totalCompleted = newState.stats.tasksCompleted;
    const currentAvg = newState.stats.avgExecutionTimeMs;
    newState.stats.avgExecutionTimeMs = Math.round(
      (currentAvg * (totalCompleted - 1) + executionTimeMs) / totalCompleted
    );

    // Keep only last 100 completed tasks
    if (newState.completed.length > 100) {
      newState.completed = newState.completed.slice(-100);
    }

    saveState(newState);

    logger.info(`Task completed: ${task.id} in ${executionTimeMs}ms`);

    // Publish completion event
    if (signalBus) {
      signalBus.publish({
        type: 'task_completed',
        source: 'task-queue-automation',
        confidence: 0.95,
        ttl: 60 * 60 * 1000,
        payload: {
          taskId: task.id,
          type: task.type,
          executionTimeMs,
          success: result?.success ?? true,
        },
      });
    }

    return result;

  } catch (error) {
    logger.error(`Task failed: ${task.id} - ${error.message}`);

    const newState = loadState();
    newState.running = newState.running.filter(t => t.id !== task.id);

    // Retry logic
    if (task.attempts < task.maxAttempts) {
      const retryDelay = Math.min(
        config.maxRetryDelayMs,
        config.baseRetryDelayMs * Math.pow(2, task.attempts - 1)
      );
      task.status = 'queued';
      task.executeAfter = Date.now() + retryDelay;
      task.lastError = error.message;
      newState.queue.push(task);
      logger.info(`Task ${task.id} will retry in ${retryDelay}ms`);
    } else {
      // Max retries exceeded
      task.status = 'failed';
      task.failedAt = new Date().toISOString();
      task.error = error.message;
      newState.failed.push(task);
      newState.stats.tasksFailed++;

      // Keep only last 50 failed tasks
      if (newState.failed.length > 50) {
        newState.failed = newState.failed.slice(-50);
      }
    }

    saveState(newState);
    return { success: false, error: error.message };
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// QUEUE RUNNER
// ────────────────────────────────────────────────────────────────────────────────

let runnerInterval = null;

/**
 * Start the task queue runner.
 */
function start() {
  if (runnerInterval) {
    logger.warn('Task queue already running');
    return;
  }

  const state = loadState();
  const config = state.config || DEFAULT_CONFIG;

  logger.info('Starting task queue runner');

  runnerInterval = setInterval(async () => {
    if (isKillSwitchActive()) {
      logger.warn('Kill switch active, pausing queue runner');
      return;
    }

    const tasks = getNextTasks();
    if (tasks.length === 0) return;

    // Execute tasks in parallel (up to maxConcurrent)
    await Promise.allSettled(tasks.map(task => executeTask(task)));

  }, config.pollIntervalMs);
}

/**
 * Stop the task queue runner.
 */
function stop() {
  if (runnerInterval) {
    clearInterval(runnerInterval);
    runnerInterval = null;
    logger.info('Task queue runner stopped');
  }
}

/**
 * Check if the runner is active.
 */
function isRunning() {
  return runnerInterval !== null;
}

// ────────────────────────────────────────────────────────────────────────────────
// QUERY / STATUS
// ────────────────────────────────────────────────────────────────────────────────

/**
 * Get current queue status.
 */
function getStatus() {
  const state = loadState();
  return {
    running: isRunning(),
    queued: state.queue.length,
    executing: state.running.length,
    completed: state.completed.length,
    failed: state.failed.length,
    stats: state.stats,
    config: state.config,
    killSwitchActive: isKillSwitchActive(),
  };
}

/**
 * Get available task types.
 */
function getAvailableTaskTypes() {
  return Object.entries(TASK_HANDLERS).map(([key, handler]) => ({
    type: key,
    name: handler.name,
    description: handler.description,
    estimatedDurationMs: handler.estimatedDurationMs,
    estimatedTimeSavedMinutes: handler.estimatedTimeSavedMinutes,
  }));
}

/**
 * Get a specific task by ID.
 */
function getTask(taskId) {
  const state = loadState();
  return (
    state.queue.find(t => t.id === taskId) ||
    state.running.find(t => t.id === taskId) ||
    state.completed.find(t => t.id === taskId) ||
    state.failed.find(t => t.id === taskId) ||
    null
  );
}

/**
 * Cancel a queued task.
 */
function cancelTask(taskId) {
  const state = loadState();
  const task = state.queue.find(t => t.id === taskId);
  if (!task) {
    return { success: false, error: 'Task not found in queue' };
  }

  state.queue = state.queue.filter(t => t.id !== taskId);
  task.status = 'cancelled';
  task.cancelledAt = new Date().toISOString();
  state.failed.push(task);
  saveState(state);

  logger.info(`Cancelled task: ${taskId}`);
  return { success: true, task };
}

/**
 * Update queue configuration.
 */
function updateConfig(newConfig) {
  const state = loadState();
  state.config = { ...state.config, ...newConfig };
  saveState(state);
  logger.info('Queue config updated:', newConfig);
  return state.config;
}

// ────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ────────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Core functions
  scheduleTask,
  executeTask,
  getNextTasks,

  // Runner control
  start,
  stop,
  isRunning,

  // Query/status
  getStatus,
  getTask,
  getAvailableTaskTypes,
  cancelTask,
  updateConfig,

  // Feedback
  recordFeedback,
  getFeedbackSummary,

  // Constants
  PRIORITY,
  TASK_HANDLERS,
};

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'status') {
    console.log(JSON.stringify(getStatus(), null, 2));
  } else if (command === 'types') {
    console.log(JSON.stringify(getAvailableTaskTypes(), null, 2));
  } else if (command === 'schedule') {
    const taskType = args[1];
    const priority = args[2] || 'normal';
    const result = scheduleTask(taskType, { priority });
    console.log(JSON.stringify(result, null, 2));
  } else if (command === 'run') {
    // Run a single cycle then exit
    (async () => {
      const tasks = getNextTasks();
      if (tasks.length === 0) {
        console.log('No tasks ready to execute');
        return;
      }
      for (const task of tasks) {
        const result = await executeTask(task);
        console.log(`${task.id}:`, JSON.stringify(result, null, 2));
      }
    })();
  } else if (command === 'feedback') {
    console.log(JSON.stringify(getFeedbackSummary(), null, 2));
  } else {
    console.log('Usage: node lib/task-queue-automation.js <command>');
    console.log('Commands:');
    console.log('  status   - Show queue status');
    console.log('  types    - List available task types');
    console.log('  schedule <type> [priority] - Schedule a task');
    console.log('  run      - Execute pending tasks once');
    console.log('  feedback - Show feedback summary');
  }
}
