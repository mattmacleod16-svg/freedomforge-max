# Task Queue Automation

> Time-saving automation for repetitive trading system tasks

## Overview

The Task Queue Automation module (`lib/task-queue-automation.js`) provides a priority-based task scheduling system that automates common repetitive operations in the FreedomForge trading platform. It reduces manual work by automatically executing maintenance tasks, generating reports, and performing system health checks.

## Features

- **Priority-based scheduling**: Tasks are executed based on priority (critical → high → normal → low → background)
- **Automatic retry**: Failed tasks are retried with exponential backoff
- **Task dependencies**: Tasks can depend on completion of other tasks
- **User feedback collection**: Track which automations are saving the most time
- **Kill switch integration**: All operations respect the system-wide kill switch
- **Performance metrics**: Track execution times and time saved

## Available Task Types

| Task Type | Description | Est. Duration | Est. Time Saved |
|-----------|-------------|---------------|-----------------|
| `backup` | Backs up critical data files | 30s | 5 min |
| `healthCheck` | Checks system health and reports issues | 15s | 3 min |
| `cleanup` | Removes old backup files and logs | 20s | 2 min |
| `performanceReport` | Generates trading performance summary | 10s | 10 min |
| `strategyCheck` | Analyzes strategy performance | 15s | 15 min |

## Usage

### Command Line

```bash
# View queue status
npm run task-queue:status

# List available task types
npm run task-queue:types

# Execute pending tasks
npm run task-queue:run

# Schedule a specific task
node lib/task-queue-automation.js schedule backup high
```

### Programmatic API

```javascript
const taskQueue = require('./lib/task-queue-automation');

// Schedule a task
const task = taskQueue.scheduleTask('backup', {
  priority: 'high',      // critical | high | normal | low | background
  delayMs: 5000,         // Optional: delay before execution
  params: {},            // Optional: parameters for the task handler
  dependencies: [],      // Optional: task IDs that must complete first
});

// Start the queue runner
taskQueue.start();

// Check queue status
const status = taskQueue.getStatus();
console.log(`Queued: ${status.queued}, Running: ${status.executing}`);

// Record user feedback
taskQueue.recordFeedback(task.id, {
  rating: 5,
  comment: 'Saved me lots of time!',
  timeSaved: true,
  estimatedMinutesSaved: 10,
});

// Get feedback summary
const feedback = taskQueue.getFeedbackSummary();
console.log(`Total time saved: ${feedback.totalMinutesSaved} minutes`);

// Stop the runner
taskQueue.stop();
```

## Configuration

Configure via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `TASK_QUEUE_MAX_CONCURRENT` | `3` | Maximum concurrent tasks |
| `TASK_QUEUE_MAX_RETRIES` | `3` | Max retry attempts per task |
| `TASK_QUEUE_RETRY_DELAY_MS` | `5000` | Base retry delay (doubles each attempt) |
| `TASK_QUEUE_MAX_RETRY_DELAY_MS` | `60000` | Maximum retry delay |
| `TASK_QUEUE_POLL_INTERVAL_MS` | `10000` | How often to check for pending tasks |
| `TASK_QUEUE_TIMEOUT_MS` | `300000` | Task execution timeout (5 min) |
| `TASK_QUEUE_FEEDBACK` | `true` | Enable/disable feedback collection |

## State Files

- `data/task-queue-state.json` - Queue state, running tasks, history
- `data/task-feedback.json` - User feedback entries and summaries

## Safety Features

1. **Kill Switch**: All operations check `data/kill-switch.json` before executing
2. **Circuit Breakers**: Tasks respect existing circuit breaker states
3. **Audit Trail**: All task executions are published to the signal bus
4. **Graceful Degradation**: Failed dependencies don't block independent tasks
5. **Human Oversight**: Feedback mechanism allows users to rate automation effectiveness

## Integration with Existing Systems

The task queue integrates with:

- **Signal Bus** (`lib/agent-signal-bus.js`): Publishes task lifecycle events
- **Resilient I/O** (`lib/resilient-io.js`): Atomic state file writes
- **Trade Journal** (`lib/trade-journal.js`): Performance report generation
- **Logger** (`lib/logger.js`): Structured logging

## Adding Custom Task Types

To add a new task type, add an entry to `TASK_HANDLERS` in `lib/task-queue-automation.js`:

```javascript
TASK_HANDLERS.myNewTask = {
  name: 'My New Task',
  description: 'Description of what it does',
  estimatedDurationMs: 10000,
  estimatedTimeSavedMinutes: 5,
  handler: async (params) => {
    // Your task logic here
    return { success: true, result: 'done' };
  },
};
```

## Feedback Loop

The feedback system helps optimize which tasks are most valuable:

```javascript
// Record feedback after a task completes
taskQueue.recordFeedback(taskId, {
  rating: 1-5,           // How helpful was this automation?
  comment: '',           // Optional comments
  timeSaved: true,       // Did it save time?
  estimatedMinutesSaved: 10  // How many minutes?
});

// Get summary to understand automation effectiveness
const summary = taskQueue.getFeedbackSummary();
// {
//   totalEntries: 42,
//   avgRating: 4.2,
//   totalMinutesSaved: 350,
//   byTaskType: {
//     backup: { avgRating: 4.5, totalMinutesSaved: 120 },
//     healthCheck: { avgRating: 3.8, totalMinutesSaved: 45 },
//   }
// }
```

This data can be used to:
- Prioritize frequently-used automations
- Remove or improve low-rated tasks
- Demonstrate ROI of automation investment
