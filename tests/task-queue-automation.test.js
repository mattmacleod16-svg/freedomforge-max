/**
 * Task Queue Automation Tests
 *
 * Tests for the time-saving task queue automation module.
 */

const { describe, it, beforeEach, afterEach, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Test data directory
const testDataDir = path.resolve(process.cwd(), 'data');
const testQueueFile = path.join(testDataDir, 'task-queue-state.json');
const testFeedbackFile = path.join(testDataDir, 'task-feedback.json');

// Clean up test files
// Errors are expected when files don't exist or are being cleaned up by other tests
function cleanupTestFiles() {
  try {
    // Remove main state files
    if (fs.existsSync(testQueueFile)) fs.unlinkSync(testQueueFile);
    if (fs.existsSync(testFeedbackFile)) fs.unlinkSync(testFeedbackFile);
    // Remove backup files created by resilient-io
    for (const ext of ['.bak.0', '.bak.1', '.bak.2', '.tmp']) {
      const queueBackup = testQueueFile + ext;
      const feedbackBackup = testFeedbackFile + ext;
      if (fs.existsSync(queueBackup)) fs.unlinkSync(queueBackup);
      if (fs.existsSync(feedbackBackup)) fs.unlinkSync(feedbackBackup);
    }
  } catch {
    // Expected: files may not exist or may be locked during concurrent test cleanup
  }
}

// Reset module cache and get fresh instance
function getCleanTaskQueue() {
  // Clear all related module caches
  const modulePath = require.resolve('../lib/task-queue-automation');
  delete require.cache[modulePath];
  // Also clear resilient-io cache to avoid stale state
  try {
    const rioPath = require.resolve('../lib/resilient-io');
    delete require.cache[rioPath];
  } catch { /* ignore */ }
  return require('../lib/task-queue-automation');
}

describe('Task Queue Automation', () => {
  let taskQueue;

  beforeEach(() => {
    cleanupTestFiles();
    // Get fresh module instance
    taskQueue = getCleanTaskQueue();
    // Ensure runner is stopped
    taskQueue.stop();
  });

  afterEach(() => {
    if (taskQueue) taskQueue.stop();
    cleanupTestFiles();
  });

  describe('scheduleTask()', () => {
    it('should schedule a valid task', () => {
      const result = taskQueue.scheduleTask('backup', { priority: 'high' });

      assert.ok(result.id, 'Task should have an ID');
      assert.strictEqual(result.type, 'backup');
      assert.strictEqual(result.priorityLabel, 'high');
      assert.strictEqual(result.status, 'queued');
    });

    it('should return error for unknown task type', () => {
      const result = taskQueue.scheduleTask('unknownTask');

      assert.ok(result.error, 'Should return error');
      assert.ok(result.error.includes('Unknown task type'));
    });

    it('should assign default priority when not specified', () => {
      const result = taskQueue.scheduleTask('healthCheck');

      assert.strictEqual(result.priorityLabel, 'normal');
    });

    it('should handle delay option', () => {
      const now = Date.now();
      const result = taskQueue.scheduleTask('backup', { delayMs: 5000 });

      assert.ok(result.executeAfter >= now + 5000);
    });

    it('should track dependencies', () => {
      const task1 = taskQueue.scheduleTask('backup');
      const task2 = taskQueue.scheduleTask('cleanup', {
        dependencies: [task1.id],
      });

      assert.deepStrictEqual(task2.dependencies, [task1.id]);
    });
  });

  describe('getAvailableTaskTypes()', () => {
    it('should return list of available tasks', () => {
      const types = taskQueue.getAvailableTaskTypes();

      assert.ok(Array.isArray(types));
      assert.ok(types.length > 0);

      const backup = types.find(t => t.type === 'backup');
      assert.ok(backup, 'Should include backup task');
      assert.ok(backup.name, 'Should have a name');
      assert.ok(backup.description, 'Should have a description');
      assert.ok(backup.estimatedDurationMs > 0, 'Should have estimated duration');
    });
  });

  describe('getStatus()', () => {
    it('should return queue status', () => {
      const status = taskQueue.getStatus();

      assert.strictEqual(typeof status.running, 'boolean');
      assert.strictEqual(typeof status.queued, 'number');
      assert.strictEqual(typeof status.executing, 'number');
      assert.strictEqual(typeof status.completed, 'number');
      assert.strictEqual(typeof status.failed, 'number');
      assert.ok(status.stats, 'Should include stats');
      assert.ok(status.config, 'Should include config');
    });

    it('should reflect scheduled tasks in queue count', () => {
      // Start fresh - get status before scheduling
      const before = taskQueue.getStatus();
      const initialQueued = before.queued;
      
      taskQueue.scheduleTask('backup');
      taskQueue.scheduleTask('healthCheck');

      const status = taskQueue.getStatus();
      assert.strictEqual(status.queued, initialQueued + 2, 'Queued count should reflect scheduled tasks');
    });
  });

  describe('getTask()', () => {
    it('should retrieve a scheduled task by ID', () => {
      const scheduled = taskQueue.scheduleTask('backup');
      const retrieved = taskQueue.getTask(scheduled.id);

      assert.ok(retrieved);
      assert.strictEqual(retrieved.id, scheduled.id);
      assert.strictEqual(retrieved.type, 'backup');
    });

    it('should return null for non-existent task', () => {
      const result = taskQueue.getTask('nonexistent-task-id');
      assert.strictEqual(result, null);
    });
  });

  describe('cancelTask()', () => {
    it('should cancel a queued task', () => {
      const scheduled = taskQueue.scheduleTask('backup');
      const result = taskQueue.cancelTask(scheduled.id);

      assert.ok(result.success);
      assert.strictEqual(result.task.status, 'cancelled');
    });

    it('should return error for non-existent task', () => {
      const result = taskQueue.cancelTask('nonexistent-task-id');

      assert.ok(!result.success);
      assert.ok(result.error.includes('not found'));
    });
  });

  describe('getNextTasks()', () => {
    it('should return tasks sorted by priority', () => {
      taskQueue.scheduleTask('backup', { priority: 'low' });
      taskQueue.scheduleTask('healthCheck', { priority: 'critical' });
      taskQueue.scheduleTask('cleanup', { priority: 'normal' });

      const next = taskQueue.getNextTasks();

      assert.ok(next.length > 0);
      assert.strictEqual(next[0].type, 'healthCheck', 'Critical priority should be first');
    });

    it('should respect maxConcurrentTasks config', () => {
      taskQueue.updateConfig({ maxConcurrentTasks: 2 });

      taskQueue.scheduleTask('backup');
      taskQueue.scheduleTask('healthCheck');
      taskQueue.scheduleTask('cleanup');

      const next = taskQueue.getNextTasks();

      assert.ok(next.length <= 2, 'Should not exceed max concurrent');
    });

    it('should not return tasks with unmet dependencies', () => {
      // Set high concurrency to not limit results
      taskQueue.updateConfig({ maxConcurrentTasks: 10 });
      
      const task1 = taskQueue.scheduleTask('backup');
      taskQueue.scheduleTask('cleanup', { dependencies: [task1.id] });

      const next = taskQueue.getNextTasks();

      // Should only return backup, not cleanup (dependency unmet)
      const backupInList = next.some(t => t.type === 'backup');
      const cleanupInList = next.some(t => t.type === 'cleanup');
      
      assert.ok(backupInList, 'Backup should be in next tasks');
      assert.ok(!cleanupInList, 'Cleanup should NOT be in next tasks (dependency unmet)');
    });

    it('should not return delayed tasks before their time', () => {
      taskQueue.updateConfig({ maxConcurrentTasks: 10 });
      taskQueue.scheduleTask('backup', { delayMs: 60000 }); // 1 minute delay

      const next = taskQueue.getNextTasks();
      
      // The delayed task should not appear in next tasks
      const delayedBackup = next.find(t => t.type === 'backup' && t.executeAfter > Date.now());
      assert.ok(!delayedBackup, 'Delayed backup should not be in next tasks');
    });
  });

  describe('executeTask()', () => {
    it('should execute a task and return result', async () => {
      const scheduled = taskQueue.scheduleTask('healthCheck');
      const result = await taskQueue.executeTask(scheduled);

      assert.ok(result.success, 'Task should succeed');
      assert.ok(result.checks, 'Health check should return checks');
    });

    it('should update task status to completed', async () => {
      const scheduled = taskQueue.scheduleTask('healthCheck');
      await taskQueue.executeTask(scheduled);

      const task = taskQueue.getTask(scheduled.id);
      assert.strictEqual(task.status, 'completed');
      assert.ok(task.completedAt);
      assert.ok(task.executionTimeMs >= 0);
    });

    it('should track execution time', async () => {
      const scheduled = taskQueue.scheduleTask('healthCheck');
      await taskQueue.executeTask(scheduled);

      const task = taskQueue.getTask(scheduled.id);
      assert.ok(task.executionTimeMs >= 0);
    });
  });

  describe('recordFeedback()', () => {
    it('should record feedback for a task', () => {
      const scheduled = taskQueue.scheduleTask('backup');
      const feedback = taskQueue.recordFeedback(scheduled.id, {
        rating: 5,
        comment: 'Very helpful!',
        timeSaved: true,
        estimatedMinutesSaved: 10,
      });

      assert.ok(feedback.id, 'Feedback should have ID');
      assert.strictEqual(feedback.taskId, scheduled.id);
      assert.strictEqual(feedback.rating, 5);
      assert.strictEqual(feedback.estimatedMinutesSaved, 10);
    });

    it('should clamp rating to 1-5 range', () => {
      const scheduled = taskQueue.scheduleTask('backup');

      const low = taskQueue.recordFeedback(scheduled.id, { rating: 0 });
      assert.strictEqual(low.rating, 1);

      const high = taskQueue.recordFeedback(scheduled.id, { rating: 10 });
      assert.strictEqual(high.rating, 5);
    });

    it('should update time saved stats', () => {
      const scheduled = taskQueue.scheduleTask('backup');
      taskQueue.recordFeedback(scheduled.id, {
        rating: 4,
        timeSaved: true,
        estimatedMinutesSaved: 5,
      });

      const status = taskQueue.getStatus();
      assert.ok(status.stats.totalTimeSavedMs >= 5 * 60 * 1000);
    });
  });

  describe('getFeedbackSummary()', () => {
    it('should return feedback summary', () => {
      const scheduled = taskQueue.scheduleTask('backup');
      taskQueue.recordFeedback(scheduled.id, { rating: 4, estimatedMinutesSaved: 5 });
      taskQueue.recordFeedback(scheduled.id, { rating: 5, estimatedMinutesSaved: 10 });

      const summary = taskQueue.getFeedbackSummary();

      assert.ok(summary.totalEntries >= 2);
      assert.ok(summary.avgRating > 0);
      assert.ok(summary.totalMinutesSaved >= 15);
    });
  });

  describe('updateConfig()', () => {
    it('should update configuration', () => {
      const newConfig = taskQueue.updateConfig({
        maxConcurrentTasks: 5,
        maxRetries: 5,
      });

      assert.strictEqual(newConfig.maxConcurrentTasks, 5);
      assert.strictEqual(newConfig.maxRetries, 5);
    });

    it('should preserve existing config values', () => {
      const original = taskQueue.getStatus().config;
      taskQueue.updateConfig({ maxConcurrentTasks: 10 });
      const updated = taskQueue.getStatus().config;

      assert.strictEqual(updated.maxConcurrentTasks, 10);
      assert.strictEqual(updated.pollIntervalMs, original.pollIntervalMs);
    });
  });

  describe('start() and stop()', () => {
    it('should start and stop the runner', () => {
      assert.strictEqual(taskQueue.isRunning(), false, 'Should not be running initially');

      taskQueue.start();
      assert.strictEqual(taskQueue.isRunning(), true, 'Should be running after start');

      taskQueue.stop();
      assert.strictEqual(taskQueue.isRunning(), false, 'Should not be running after stop');
    });

    it('should warn if started twice', () => {
      taskQueue.start();
      taskQueue.start(); // Should not throw
      assert.strictEqual(taskQueue.isRunning(), true);
      taskQueue.stop();
    });
  });

  describe('PRIORITY constants', () => {
    it('should have correct priority order', () => {
      const { PRIORITY } = taskQueue;

      assert.ok(PRIORITY.critical < PRIORITY.high);
      assert.ok(PRIORITY.high < PRIORITY.normal);
      assert.ok(PRIORITY.normal < PRIORITY.low);
      assert.ok(PRIORITY.low < PRIORITY.background);
    });
  });

  describe('TASK_HANDLERS registry', () => {
    it('should have required task handlers', () => {
      const { TASK_HANDLERS } = taskQueue;

      assert.ok(TASK_HANDLERS.backup, 'Should have backup handler');
      assert.ok(TASK_HANDLERS.healthCheck, 'Should have healthCheck handler');
      assert.ok(TASK_HANDLERS.cleanup, 'Should have cleanup handler');
      assert.ok(TASK_HANDLERS.performanceReport, 'Should have performanceReport handler');
      assert.ok(TASK_HANDLERS.strategyCheck, 'Should have strategyCheck handler');
    });

    it('should have valid handler structure', () => {
      const { TASK_HANDLERS } = taskQueue;

      for (const [key, handler] of Object.entries(TASK_HANDLERS)) {
        assert.ok(handler.name, `${key} should have name`);
        assert.ok(handler.description, `${key} should have description`);
        assert.ok(typeof handler.handler === 'function', `${key} should have handler function`);
        assert.ok(handler.estimatedDurationMs > 0, `${key} should have estimated duration`);
      }
    });
  });
});
