/**
 * TypeScript wrapper for the unified logger (logger.js).
 * Dashboard & API routes import from here; all logging goes through logger.js.
 *
 * Maintains backward-compatible API:  logEvent(type, payload)  +  readLast(n)
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const unifiedLogger = require('./logger');

export async function logEvent(type: string, payload: Record<string, any>) {
  try {
    unifiedLogger.logEvent(type, payload);
  } catch (err) {
    console.error('logger.ts logEvent error', err);
  }
}

export async function readLast(n = 200) {
  try {
    return unifiedLogger.readLast(n);
  } catch (err) {
    console.error('logger.ts readLast error', err);
    return [];
  }
}

export function getMetrics(reset = false) {
  return unifiedLogger.getMetrics(reset);
}

export function createLogger(agentName: string) {
  return unifiedLogger.createLogger(agentName);
}
