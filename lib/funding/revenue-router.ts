/**
 * Revenue Router — Goal-Based Allocation Engine
 * ══════════════════════════════════════════════
 *
 * Routes incoming revenue to named funding goals with progress tracking.
 * Persists state to a JSON ledger. Goals are prioritised by priority score.
 *
 * Phase 1–3 plan integration:
 *  - "F-150 bumper fund" → priority 1
 *  - "Standby capital" → priority 0 (always funded first)
 *  - "Quarterly reinvestment" → priority 2
 */

import fs from 'fs';
import path from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RevenueGoal {
  id: string;
  name: string;
  description: string;
  targetUsd: number;
  currentUsd: number;
  priority: number;       // lower = higher priority
  allocationPct: number;  // 0–100, share of incoming revenue
  status: 'active' | 'paused' | 'completed';
  createdAt: number;
  completedAt?: number;
}

export interface RevenueAllocation {
  goalId: string;
  goalName: string;
  amountUsd: number;
  pct: number;
  timestamp: number;
  source: string;
}

export interface RouterState {
  goals: RevenueGoal[];
  totalRouted: number;
  allocations: RevenueAllocation[];
  lastUpdated: number;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

const LEDGER_PATH = path.join(process.cwd(), 'data', 'revenue-router.json');

function ensureDataDir() {
  const dir = path.dirname(LEDGER_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadState(): RouterState {
  ensureDataDir();
  if (!fs.existsSync(LEDGER_PATH)) {
    return getDefaultState();
  }
  try {
    return JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8')) as RouterState;
  } catch {
    return getDefaultState();
  }
}

function saveState(state: RouterState): void {
  ensureDataDir();
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(state, null, 2));
}

function getDefaultState(): RouterState {
  const now = Date.now();
  return {
    goals: [
      {
        id: 'standby-capital',
        name: 'Standby Capital Reserve',
        description: 'Always-ready liquidity buffer for high-conviction trades',
        targetUsd: 10000,
        currentUsd: 0,
        priority: 0,
        allocationPct: 40,
        status: 'active',
        createdAt: now,
      },
      {
        id: 'f150-bumper',
        name: 'F-150 Bumper Fund',
        description: 'Accelerate F-150 bumper sale flip with marketing budget',
        targetUsd: 2500,
        currentUsd: 0,
        priority: 1,
        allocationPct: 30,
        status: 'active',
        createdAt: now,
      },
      {
        id: 'quarterly-reinvestment',
        name: 'Quarterly Reinvestment Pool',
        description: 'Compounding capital for next quarterly engine optimization cycle',
        targetUsd: 50000,
        currentUsd: 0,
        priority: 2,
        allocationPct: 20,
        status: 'active',
        createdAt: now,
      },
      {
        id: 'operations',
        name: 'Operations & API Costs',
        description: 'API credits, server costs, OpenRouter usage',
        targetUsd: 500,
        currentUsd: 0,
        priority: 3,
        allocationPct: 10,
        status: 'active',
        createdAt: now,
      },
    ],
    totalRouted: 0,
    allocations: [],
    lastUpdated: now,
  };
}

// ─── Core Engine ──────────────────────────────────────────────────────────────

/**
 * Route an incoming revenue amount across active goals by allocation %.
 * Marks goals as completed when target is reached.
 */
export function routeRevenue(
  amountUsd: number,
  source = 'trading',
): RevenueAllocation[] {
  if (amountUsd <= 0) return [];

  const state = loadState();
  const activeGoals = state.goals
    .filter((g) => g.status === 'active')
    .sort((a, b) => a.priority - b.priority);

  const totalPct = activeGoals.reduce((s, g) => s + g.allocationPct, 0);
  const allocations: RevenueAllocation[] = [];

  for (const goal of activeGoals) {
    const share = totalPct > 0 ? (goal.allocationPct / totalPct) : (1 / activeGoals.length);
    const allocated = amountUsd * share;

    goal.currentUsd += allocated;
    if (goal.currentUsd >= goal.targetUsd) {
      goal.currentUsd = goal.targetUsd;
      goal.status = 'completed';
      goal.completedAt = Date.now();
    }

    const entry: RevenueAllocation = {
      goalId: goal.id,
      goalName: goal.name,
      amountUsd: Math.round(allocated * 100) / 100,
      pct: Math.round(share * 100 * 10) / 10,
      timestamp: Date.now(),
      source,
    };
    allocations.push(entry);
    state.allocations.push(entry);
  }

  state.totalRouted += amountUsd;
  state.lastUpdated = Date.now();
  saveState(state);

  return allocations;
}

/** Add or update a funding goal */
export function upsertGoal(goal: Omit<RevenueGoal, 'createdAt' | 'currentUsd'>): RevenueGoal {
  const state = loadState();
  const existing = state.goals.find((g) => g.id === goal.id);
  if (existing) {
    Object.assign(existing, goal);
    saveState(state);
    return existing;
  }
  const newGoal: RevenueGoal = { ...goal, currentUsd: 0, createdAt: Date.now() };
  state.goals.push(newGoal);
  saveState(state);
  return newGoal;
}

/** Get current router state (goals + allocation history) */
export function getRouterState(): RouterState {
  return loadState();
}

/** Get progress summary for all goals */
export function getGoalProgress(): Array<RevenueGoal & { progressPct: number; remaining: number }> {
  const state = loadState();
  return state.goals.map((g) => ({
    ...g,
    progressPct: g.targetUsd > 0 ? Math.min(100, Math.round((g.currentUsd / g.targetUsd) * 1000) / 10) : 0,
    remaining: Math.max(0, g.targetUsd - g.currentUsd),
  }));
}

/** Get recent allocations (last N) */
export function getRecentAllocations(limit = 20): RevenueAllocation[] {
  const state = loadState();
  return state.allocations.slice(-limit).reverse();
}

/** Reset a goal's progress (without deleting it) */
export function resetGoal(id: string): void {
  const state = loadState();
  const goal = state.goals.find((g) => g.id === id);
  if (goal) {
    goal.currentUsd = 0;
    goal.status = 'active';
    delete goal.completedAt;
    state.lastUpdated = Date.now();
    saveState(state);
  }
}
