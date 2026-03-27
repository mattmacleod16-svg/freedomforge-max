/**
 * FreedomForge HappinessForge — Happiness Engine
 *
 * Scores user fulfillment (0–100) across three pillars:
 *   - Financial Freedom   (40%)
 *   - Time Freedom        (30%)
 *   - Peace of Mind       (30%)
 *
 * Returns a score with a breakdown and actionable suggestions.
 */

import { UserMetrics, HappinessScore } from '@/lib/types';

// ─── Weights ──────────────────────────────────────────────────────────────────

const WEIGHT_FINANCIAL    = 0.40;
const WEIGHT_TIME         = 0.30;
const WEIGHT_PEACE        = 0.30;

// ─── Scoring helpers ──────────────────────────────────────────────────────────

/**
 * Financial freedom score: maps portfolio return to 0–100.
 * +30% → 100, 0% → 50, -20% → 0.
 */
function scoreFinancial(returnPct: number): number {
  // Sigmoid-like mapping: saturates at ±50%
  const normalized = (returnPct + 20) / 50; // -20%→0, +30%→1
  return clamp(normalized * 100, 0, 100);
}

/**
 * Time freedom score: maps freed hours/week to 0–100.
 * 0h → 0, 20h → 100.
 */
function scoreTimeFreedom(hoursPerWeek: number): number {
  return clamp((hoursPerWeek / 20) * 100, 0, 100);
}

/**
 * Peace of mind score: penalized by open alerts and rewarded by
 * high AI satisfaction and autonomy ratio.
 */
function scorePeaceOfMind(
  openAlerts: number,
  aiSatisfaction: number,
  autonomyRatio: number,
): number {
  // Alert penalty: each unresolved alert costs up to 5 points (max 50 point penalty)
  const alertPenalty = Math.min(openAlerts * 5, 50);
  // AI satisfaction: 1–5 scale → 0–30 points
  const satisfactionScore = ((aiSatisfaction - 1) / 4) * 30;
  // Autonomy: 0–1 → 0–20 points
  const autonomyScore = autonomyRatio * 20;

  return clamp(50 - alertPenalty + satisfactionScore + autonomyScore, 0, 100);
}

// ─── Suggestion generator ─────────────────────────────────────────────────────

function buildSuggestions(
  metrics: UserMetrics,
  financial: number,
  time: number,
  peace: number,
): string[] {
  const suggestions: string[] = [];

  if (financial < 40) {
    suggestions.push(
      'Review your active trading strategies — enable the ensemble auto-policy to diversify returns.'
    );
  }
  if (financial < 70 && metrics.financialReturnPct < 5) {
    suggestions.push(
      'Consider activating the yield-intelligence engine to capture passive DeFi returns.'
    );
  }
  if (time < 40) {
    suggestions.push(
      'Increase autonomy ratio — delegate more decisions to the AI orchestrator.'
    );
  }
  if (time < 70 && metrics.timeFreedomHrsPerWeek < 10) {
    suggestions.push(
      'Set up automated watchdog alerts to replace manual monitoring sessions.'
    );
  }
  if (peace < 40) {
    suggestions.push(
      `You have ${metrics.openAlertCount} open alerts — resolve or acknowledge them to reduce noise.`
    );
  }
  if (metrics.aiSatisfactionScore < 3) {
    suggestions.push(
      'Your AI satisfaction is below average — try switching to a frontier reasoning model in Settings.'
    );
  }
  if (metrics.autonomyRatio < 0.3) {
    suggestions.push(
      'Enabling more autonomous workflows could free significant time and reduce cognitive load.'
    );
  }

  return suggestions.length > 0
    ? suggestions
    : ['Great work — your FreedomForge metrics are all in a healthy range!'];
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function calculateHappinessScore(metrics: UserMetrics): HappinessScore {
  const financial = scoreFinancial(metrics.financialReturnPct);
  const time      = scoreTimeFreedom(metrics.timeFreedomHrsPerWeek);
  const peace     = scorePeaceOfMind(
    metrics.openAlertCount,
    metrics.aiSatisfactionScore,
    metrics.autonomyRatio,
  );

  const total = clamp(
    financial * WEIGHT_FINANCIAL + time * WEIGHT_TIME + peace * WEIGHT_PEACE,
    0,
    100,
  );

  return {
    total: Math.round(total),
    breakdown: {
      financialFreedom: Math.round(financial),
      timeFreedom:      Math.round(time),
      peaceOfMind:      Math.round(peace),
    },
    suggestions: buildSuggestions(metrics, financial, time, peace),
    timestamp: Date.now(),
  };
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ─── Class wrapper + singleton ────────────────────────────────────────────────

export class HappinessForge {
  async giftFulfillment(profile: { userId: string }): Promise<{ joyUplift: number }> {
    const score = calculateHappinessScore({
      financialReturnPct:      10,
      timeFreedomHrsPerWeek:   5,
      openAlertCount:          0,
      aiSatisfactionScore:     4,
      autonomyRatio:           0.5,
    });
    return { joyUplift: score.total / 100 };
  }
}

export const happinessForge = new HappinessForge();
