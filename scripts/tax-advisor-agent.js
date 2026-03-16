#!/usr/bin/env node
/**
 * FreedomForge Tax Advisor Agent
 * ═══════════════════════════════
 *
 * Autonomous tax optimization agent that runs alongside the trading system.
 * Publishes actionable signals to the agent signal bus so other agents
 * (edge-detector, master-orchestrator, profit-scorecard) can make
 * tax-aware decisions that maximize the owner's after-tax income.
 *
 * Knowledge domains:
 *   - IRC Section 1256 (60/40 futures treatment)
 *   - Short-term vs long-term capital gains holding periods
 *   - Tax-loss harvesting opportunities
 *   - Wash sale rule avoidance (30-day window)
 *   - DeFi yield income classification
 *   - Prediction market gain treatment
 *   - Quarterly estimated tax planning
 *   - Entity structure awareness (individual vs LLC vs S-Corp)
 *
 * Signal bus integration:
 *   Publishes: tax_optimization (TTL 12h)
 *   Consumes: asset_intelligence, market_regime, forecast
 *
 * Usage:
 *   node scripts/tax-advisor-agent.js
 *
 * Environment:
 *   TAX_ADVISOR_ENABLED=true          Enable/disable (default: true)
 *   TAX_FILING_STATUS=single          single|married_joint|married_separate|head_of_household
 *   TAX_STATE=CA                      State abbreviation for state tax estimate
 *   TAX_ENTITY_TYPE=individual        individual|llc|scorp
 *   TAX_ANNUAL_INCOME_ESTIMATE=0      Other W2/1099 income for bracket estimation
 *   TAX_LOSS_HARVEST_MIN_USD=50       Minimum unrealized loss to trigger harvest signal
 *   TAX_PREFER_1256=true              Prefer 1256-eligible instruments when edge is similar
 *   TAX_QUARTERLY_ALERTS=true         Alert before quarterly estimated payment deadlines
 *   TAX_ADVISOR_INTERVAL_HOURS=6      How often to run analysis (default: 6)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const { createLogger } = require('../lib/logger');
const logger = createLogger('tax-advisor-agent');

const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://freedomforge-max.up.railway.app').replace(/\/$/, '');
const ALERT_URL = process.env.ALERT_WEBHOOK_URL || '';
const ALERT_MENTION = (process.env.ALERT_MENTION || '').trim();

// ─── Configuration ──────────────────────────────────────────────────────────────
const ENABLED = String(process.env.TAX_ADVISOR_ENABLED || 'true').toLowerCase() !== 'false';
const FILING_STATUS = process.env.TAX_FILING_STATUS || 'single';
const STATE = (process.env.TAX_STATE || '').toUpperCase();
const ENTITY_TYPE = process.env.TAX_ENTITY_TYPE || 'individual';
const OTHER_INCOME = Math.max(0, Number(process.env.TAX_ANNUAL_INCOME_ESTIMATE || 0));
const LOSS_HARVEST_MIN = Math.max(1, Number(process.env.TAX_LOSS_HARVEST_MIN_USD || 50));
const PREFER_1256 = String(process.env.TAX_PREFER_1256 || 'true').toLowerCase() !== 'false';
const QUARTERLY_ALERTS = String(process.env.TAX_QUARTERLY_ALERTS || 'true').toLowerCase() !== 'false';

// ─── Federal Tax Brackets (2026 projected) ──────────────────────────────────────
const FEDERAL_BRACKETS = {
  single: [
    { min: 0, max: 11925, rate: 0.10 },
    { min: 11925, max: 48475, rate: 0.12 },
    { min: 48475, max: 103350, rate: 0.22 },
    { min: 103350, max: 197300, rate: 0.24 },
    { min: 197300, max: 250525, rate: 0.32 },
    { min: 250525, max: 626350, rate: 0.35 },
    { min: 626350, max: Infinity, rate: 0.37 },
  ],
  married_joint: [
    { min: 0, max: 23850, rate: 0.10 },
    { min: 23850, max: 96950, rate: 0.12 },
    { min: 96950, max: 206700, rate: 0.22 },
    { min: 206700, max: 394600, rate: 0.24 },
    { min: 394600, max: 501050, rate: 0.32 },
    { min: 501050, max: 751600, rate: 0.35 },
    { min: 751600, max: Infinity, rate: 0.37 },
  ],
  married_separate: [
    { min: 0, max: 11925, rate: 0.10 },
    { min: 11925, max: 48475, rate: 0.12 },
    { min: 48475, max: 103350, rate: 0.22 },
    { min: 103350, max: 197300, rate: 0.24 },
    { min: 197300, max: 250525, rate: 0.32 },
    { min: 250525, max: 375800, rate: 0.35 },
    { min: 375800, max: Infinity, rate: 0.37 },
  ],
  head_of_household: [
    { min: 0, max: 17000, rate: 0.10 },
    { min: 17000, max: 64850, rate: 0.12 },
    { min: 64850, max: 103350, rate: 0.22 },
    { min: 103350, max: 197300, rate: 0.24 },
    { min: 197300, max: 250500, rate: 0.32 },
    { min: 250500, max: 626350, rate: 0.35 },
    { min: 626350, max: Infinity, rate: 0.37 },
  ],
};

// Long-term capital gains brackets (2026 projected)
const LTCG_BRACKETS = {
  single: [
    { min: 0, max: 48350, rate: 0.00 },
    { min: 48350, max: 533400, rate: 0.15 },
    { min: 533400, max: Infinity, rate: 0.20 },
  ],
  married_joint: [
    { min: 0, max: 96700, rate: 0.00 },
    { min: 96700, max: 600050, rate: 0.15 },
    { min: 600050, max: Infinity, rate: 0.20 },
  ],
  married_separate: [
    { min: 0, max: 48350, rate: 0.00 },
    { min: 48350, max: 300025, rate: 0.15 },
    { min: 300025, max: Infinity, rate: 0.20 },
  ],
  head_of_household: [
    { min: 0, max: 64750, rate: 0.00 },
    { min: 64750, max: 566700, rate: 0.15 },
    { min: 566700, max: Infinity, rate: 0.20 },
  ],
};

// Section 1256 blended rate: 60% LTCG + 40% short-term
const NIIT_THRESHOLD = { single: 200000, married_joint: 250000, married_separate: 125000, head_of_household: 200000 };
const NIIT_RATE = 0.038; // Net Investment Income Tax

// Approximate state income tax rates (top marginal)
const STATE_RATES = {
  CA: 0.133, NY: 0.109, NJ: 0.1075, HI: 0.11, MN: 0.0985,
  OR: 0.099, VT: 0.0875, IA: 0.06, WI: 0.0765, DC: 0.1075,
  CT: 0.0699, ID: 0.058, MT: 0.0675, NM: 0.059, SC: 0.065,
  AR: 0.047, GA: 0.055, MA: 0.09, IL: 0.0495, MI: 0.0425,
  NC: 0.0475, PA: 0.0307, IN: 0.0315, UT: 0.0465, CO: 0.044,
  AZ: 0.025, OH: 0.04, KY: 0.04, OK: 0.0475, MS: 0.05,
  KS: 0.057, RI: 0.0599, ME: 0.0715, NE: 0.0664, AL: 0.05,
  WV: 0.065, LA: 0.0425, DE: 0.066, MO: 0.048, VA: 0.0575,
  ND: 0.029, MD: 0.0575,
  // No state income tax
  TX: 0, FL: 0, NV: 0, WA: 0, WY: 0, AK: 0, SD: 0, TN: 0, NH: 0,
};

// Quarterly estimated tax deadlines (standard)
const QUARTERLY_DEADLINES = [
  { q: 'Q1', deadline: '04-15', coversMonths: 'Jan–Mar' },
  { q: 'Q2', deadline: '06-15', coversMonths: 'Apr–May' },
  { q: 'Q3', deadline: '09-15', coversMonths: 'Jun–Aug' },
  { q: 'Q4', deadline: '01-15', coversMonths: 'Sep–Dec' },
];

// ─── Trade Classification ───────────────────────────────────────────────────────

/**
 * Classify a trade for tax purposes.
 *
 * @param {object} trade - Trade journal entry
 * @returns {object} Tax classification with category, treatment, and notes
 */
function classifyTrade(trade) {
  const venue = (trade.venue || '').toLowerCase();
  const asset = (trade.asset || '').toUpperCase();
  const strategy = (trade.strategy || '').toLowerCase();
  const holdingMs = trade.closedAt ? (new Date(trade.closedAt).getTime() - (trade.entryTs || trade.ts)) : null;
  const holdingDays = holdingMs ? holdingMs / (1000 * 60 * 60 * 24) : null;

  // Section 1256 contracts — regulated futures get 60/40 treatment
  if (strategy.includes('futures') || strategy.includes('basis') || strategy.includes('perp')) {
    return {
      taxCategory: '1256_contract',
      treatment: '60/40 (60% LTCG / 40% short-term)',
      section: 'IRC §1256',
      holdingDays,
      lossCarryback: true, // 1256 losses can carry back 3 years
      notes: 'Mark-to-market at year-end regardless of position status. Losses carry back 3 years.',
    };
  }

  // Prediction markets (Polymarket, Kalshi)
  if (venue === 'polymarket' || venue === 'kalshi' || strategy.includes('prediction') || strategy.includes('clob')) {
    return {
      taxCategory: 'prediction_market',
      treatment: 'Ordinary income (likely)',
      section: 'IRC §1001 / §988',
      holdingDays,
      lossCarryback: false,
      notes: 'IRS guidance evolving. Conservative: treat as ordinary income. May qualify as §1256 if exchange-regulated.',
    };
  }

  // DeFi yield
  if (strategy.includes('defi') || strategy.includes('yield') || strategy.includes('aave') || strategy.includes('compound')) {
    return {
      taxCategory: 'defi_yield',
      treatment: 'Ordinary income (at receipt)',
      section: 'IRC §61',
      holdingDays: 0,
      lossCarryback: false,
      notes: 'Yield/interest is ordinary income when received. Subsequent sale of received tokens is separate capital event.',
    };
  }

  // Arbitrage — short-term by nature
  if (strategy.includes('arb') || strategy.includes('arbitrage')) {
    return {
      taxCategory: 'short_term_capital',
      treatment: 'Short-term capital gains (ordinary rates)',
      section: 'IRC §1222',
      holdingDays: holdingDays || 0,
      lossCarryback: false,
      notes: 'Arb trades held <1 day. Taxed at ordinary income rates.',
    };
  }

  // Staking rewards
  if (strategy.includes('staking') || strategy.includes('stake')) {
    return {
      taxCategory: 'staking_reward',
      treatment: 'Ordinary income (at receipt)',
      section: 'IRC §61 (Rev. Rul. 2023-14)',
      holdingDays: 0,
      lossCarryback: false,
      notes: 'Staking rewards taxed as ordinary income at fair market value when received.',
    };
  }

  // Spot crypto trades — depends on holding period
  const isLongTerm = holdingDays !== null && holdingDays > 365;
  return {
    taxCategory: isLongTerm ? 'long_term_capital' : 'short_term_capital',
    treatment: isLongTerm ? 'Long-term capital gains (preferential rates)' : 'Short-term capital gains (ordinary rates)',
    section: 'IRC §1222',
    holdingDays,
    lossCarryback: false,
    notes: isLongTerm
      ? 'Held >1 year. Taxed at 0/15/20% depending on income.'
      : 'Held ≤1 year. Taxed at ordinary income rates.',
  };
}

// ─── Tax Computation ────────────────────────────────────────────────────────────

function getMarginalRate(income, brackets) {
  for (let i = brackets.length - 1; i >= 0; i--) {
    if (income > brackets[i].min) return brackets[i].rate;
  }
  return brackets[0].rate;
}

function computeEffectiveTax(income, brackets) {
  let tax = 0;
  let remaining = income;
  for (const bracket of brackets) {
    const taxable = Math.min(remaining, bracket.max - bracket.min);
    if (taxable <= 0) break;
    tax += taxable * bracket.rate;
    remaining -= taxable;
  }
  return tax;
}

function compute1256BlendedRate(totalIncome, filingStatus) {
  const brackets = FEDERAL_BRACKETS[filingStatus] || FEDERAL_BRACKETS.single;
  const ltcgBrackets = LTCG_BRACKETS[filingStatus] || LTCG_BRACKETS.single;
  const shortTermRate = getMarginalRate(totalIncome, brackets);
  const ltcgRate = getMarginalRate(totalIncome, ltcgBrackets);
  return 0.6 * ltcgRate + 0.4 * shortTermRate;
}

function estimateTaxOnGain(gainUsd, classification, totalIncome, filingStatus) {
  const brackets = FEDERAL_BRACKETS[filingStatus] || FEDERAL_BRACKETS.single;
  const ltcgBrackets = LTCG_BRACKETS[filingStatus] || LTCG_BRACKETS.single;
  const stateRate = STATE_RATES[STATE] || 0;

  let federalRate;
  if (classification.taxCategory === '1256_contract') {
    federalRate = compute1256BlendedRate(totalIncome + gainUsd, filingStatus);
  } else if (classification.taxCategory === 'long_term_capital') {
    federalRate = getMarginalRate(totalIncome + gainUsd, ltcgBrackets);
  } else {
    // Ordinary income: short-term, prediction, defi, staking, arb
    federalRate = getMarginalRate(totalIncome + gainUsd, brackets);
  }

  // NIIT check (3.8% on investment income above threshold)
  const niitThresh = NIIT_THRESHOLD[filingStatus] || 200000;
  const niit = (totalIncome + gainUsd > niitThresh) ? NIIT_RATE : 0;

  const totalRate = federalRate + niit + stateRate;
  const taxOwed = gainUsd * totalRate;
  const afterTax = gainUsd - taxOwed;

  return {
    federalRate: Math.round(federalRate * 10000) / 100,
    niitRate: Math.round(niit * 10000) / 100,
    stateRate: Math.round(stateRate * 10000) / 100,
    effectiveRate: Math.round(totalRate * 10000) / 100,
    taxOwed: Math.round(taxOwed * 100) / 100,
    afterTax: Math.round(afterTax * 100) / 100,
  };
}

// ─── Tax-Loss Harvesting ────────────────────────────────────────────────────────

function findHarvestOpportunities(trades) {
  // Find open positions (or recently closed) with unrealized losses
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const opportunities = [];

  // Group closed trades by asset to detect wash sale windows
  const recentBuys = {};
  for (const t of trades) {
    if (t.side === 'buy' && t.ts > now - thirtyDaysMs) {
      if (!recentBuys[t.asset]) recentBuys[t.asset] = [];
      recentBuys[t.asset].push(t);
    }
  }

  // Find losing positions that could be harvested
  for (const t of trades) {
    if (t.pnl !== null && t.pnl < -LOSS_HARVEST_MIN) {
      const washSaleRisk = (recentBuys[t.asset] || []).some(
        buy => Math.abs(buy.ts - (t.closedAt ? new Date(t.closedAt).getTime() : t.ts)) < thirtyDaysMs
      );

      opportunities.push({
        asset: t.asset,
        venue: t.venue,
        loss: t.pnl,
        tradeId: t.id,
        washSaleRisk,
        recommendation: washSaleRisk
          ? `Loss of $${Math.abs(t.pnl).toFixed(2)} on ${t.asset} — WASH SALE RISK: avoid repurchasing ${t.asset} for 30 days`
          : `Harvest $${Math.abs(t.pnl).toFixed(2)} loss on ${t.asset} — can offset gains. Safe to repurchase after 31 days.`,
      });
    }
  }

  return opportunities;
}

// ─── Quarterly Estimated Tax ────────────────────────────────────────────────────

function getNextQuarterlyDeadline() {
  const now = new Date();
  const year = now.getFullYear();

  for (const q of QUARTERLY_DEADLINES) {
    const deadlineYear = q.q === 'Q4' ? year + 1 : year;
    const d = new Date(`${deadlineYear}-${q.deadline}T23:59:59`);
    if (d > now) {
      const daysUntil = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
      return { ...q, date: d.toISOString().split('T')[0], daysUntil, year: deadlineYear };
    }
  }

  // Wrap to next year Q1
  return {
    q: 'Q1',
    deadline: '04-15',
    coversMonths: 'Jan–Mar',
    date: `${year + 1}-04-15`,
    daysUntil: Math.ceil((new Date(`${year + 1}-04-15`) - now) / (1000 * 60 * 60 * 24)),
    year: year + 1,
  };
}

// ─── Venue Preference Signal ────────────────────────────────────────────────────

function computeVenuePreference(totalIncome, filingStatus) {
  // Compare after-tax returns for different trade types
  const gain = 100; // normalize to $100 gain

  const spotTax = estimateTaxOnGain(gain, { taxCategory: 'short_term_capital' }, totalIncome, filingStatus);
  const futuresTax = estimateTaxOnGain(gain, { taxCategory: '1256_contract' }, totalIncome, filingStatus);
  const ltcgTax = estimateTaxOnGain(gain, { taxCategory: 'long_term_capital' }, totalIncome, filingStatus);

  const savings1256 = spotTax.taxOwed - futuresTax.taxOwed;
  const savingsLtcg = spotTax.taxOwed - ltcgTax.taxOwed;

  return {
    shortTermRate: spotTax.effectiveRate,
    section1256Rate: futuresTax.effectiveRate,
    longTermRate: ltcgTax.effectiveRate,
    savings1256PerHundred: Math.round(savings1256 * 100) / 100,
    savingsLtcgPerHundred: Math.round(savingsLtcg * 100) / 100,
    recommendation: PREFER_1256 && savings1256 > 2
      ? 'PREFER_FUTURES: Section 1256 saves $' + savings1256.toFixed(2) + ' per $100 gain vs spot'
      : 'NEUTRAL: Tax difference minimal at current income level',
  };
}

// ─── Entity Structure Guidance ──────────────────────────────────────────────────

function entityGuidance(totalIncome, tradingIncome) {
  const notes = [];

  if (ENTITY_TYPE === 'individual') {
    if (tradingIncome > 50000) {
      notes.push('Consider LLC/S-Corp election: trading expenses (API costs, infrastructure) become business deductions');
      notes.push('Mark-to-market §475(f) election available to traders — converts all gains to ordinary (no $3K loss cap, but loses 60/40)');
    }
    if (totalIncome > 160000) {
      notes.push('Self-employment tax applies to trading income in some structures — S-Corp can reduce SE tax');
    }
    notes.push('Solo 401(k) contributions can shelter up to $23,500 + 25% of net self-employment income');
  }

  if (ENTITY_TYPE === 'llc') {
    notes.push('LLC trading expenses (API costs $' + (5 * 365).toFixed(0) + '/yr, hosting, data feeds) are deductible against trading income');
    notes.push('Health insurance premiums may be deductible if self-employed');
    notes.push('Consider S-Corp election if net income exceeds $50K to reduce self-employment tax');
  }

  if (ENTITY_TYPE === 'scorp') {
    notes.push('Reasonable salary required — but remaining profits avoid SE tax (15.3% savings)');
    notes.push('All trading infrastructure costs are business expenses');
    notes.push('Retirement plan contributions available: SEP-IRA or Solo 401(k)');
  }

  return { entityType: ENTITY_TYPE, notes };
}

// ─── Main Analysis ──────────────────────────────────────────────────────────────

async function fetchJson(pathname) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.ALERT_SECRET) headers['x-api-secret'] = process.env.ALERT_SECRET;
    const res = await fetch(`${APP_BASE_URL}${pathname}`, {
      headers,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${pathname}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function withMention(message) {
  if (!ALERT_MENTION) return message;
  return `${ALERT_MENTION} ${message}`;
}

async function sendAlert(message) {
  if (!ALERT_URL) {
    console.log(message);
    return;
  }
  const body = JSON.stringify({ content: withMention(message), text: withMention(message) });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(ALERT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok || res.status < 500) return;
      } finally { clearTimeout(timer); }
    } catch (err) { logger.warn('alert retry failed', { attempt, error: err?.message || err }); }
    if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
  }
}

async function main() {
  if (!ENABLED) {
    console.log('[tax-advisor] Disabled via TAX_ADVISOR_ENABLED=false');
    process.exit(0);
  }

  console.log(`[tax-advisor] Starting analysis (filing=${FILING_STATUS} state=${STATE || 'none'} entity=${ENTITY_TYPE})`);

  // ─── Load trade journal ──────────────────────────────────────────────
  let trades = [];
  try {
    const journalPath = path.resolve(process.cwd(), process.env.TRADE_JOURNAL_FILE || 'data/trade-journal.json');
    if (fs.existsSync(journalPath)) {
      const raw = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
      trades = Array.isArray(raw?.trades) ? raw.trades : [];
    }
  } catch (err) {
    logger.warn('Could not load trade journal', { error: err?.message });
  }

  // ─── Load treasury ledger for YTD income ─────────────────────────────
  let ytdPnl = 0;
  try {
    const ledgerPath = path.resolve(process.cwd(), 'data/treasury-ledger.json');
    if (fs.existsSync(ledgerPath)) {
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
      ytdPnl = ledger?.lifetimePnl || 0;
    }
  } catch {}

  const totalIncome = OTHER_INCOME + ytdPnl;

  // ─── 1. Classify all trades ──────────────────────────────────────────
  const classifications = {};
  let totalGains = 0;
  let totalLosses = 0;
  let gains1256 = 0;
  let gainsShortTerm = 0;
  let gainsLongTerm = 0;
  let gainsOrdinary = 0;

  for (const trade of trades) {
    const cls = classifyTrade(trade);
    trade._taxClass = cls; // annotate for signal

    if (trade.pnl !== null) {
      if (trade.pnl > 0) totalGains += trade.pnl;
      else totalLosses += Math.abs(trade.pnl);

      switch (cls.taxCategory) {
        case '1256_contract': gains1256 += trade.pnl; break;
        case 'long_term_capital': gainsLongTerm += trade.pnl; break;
        case 'short_term_capital': gainsShortTerm += trade.pnl; break;
        default: gainsOrdinary += trade.pnl; break;
      }
    }

    if (!classifications[cls.taxCategory]) {
      classifications[cls.taxCategory] = { count: 0, totalPnl: 0, treatment: cls.treatment };
    }
    classifications[cls.taxCategory].count++;
    classifications[cls.taxCategory].totalPnl += (trade.pnl || 0);
  }

  // ─── 2. Compute tax estimates ────────────────────────────────────────
  const venuePreference = computeVenuePreference(totalIncome, FILING_STATUS);
  const entity = entityGuidance(totalIncome, ytdPnl);

  // Estimate tax on YTD gains by category
  const taxEstimates = {};
  if (gains1256 > 0) taxEstimates['1256_contract'] = estimateTaxOnGain(gains1256, { taxCategory: '1256_contract' }, totalIncome, FILING_STATUS);
  if (gainsShortTerm > 0) taxEstimates['short_term'] = estimateTaxOnGain(gainsShortTerm, { taxCategory: 'short_term_capital' }, totalIncome, FILING_STATUS);
  if (gainsLongTerm > 0) taxEstimates['long_term'] = estimateTaxOnGain(gainsLongTerm, { taxCategory: 'long_term_capital' }, totalIncome, FILING_STATUS);
  if (gainsOrdinary > 0) taxEstimates['ordinary'] = estimateTaxOnGain(gainsOrdinary, { taxCategory: 'defi_yield' }, totalIncome, FILING_STATUS);

  // ─── 3. Tax-loss harvesting ──────────────────────────────────────────
  const harvestOpportunities = findHarvestOpportunities(trades);

  // ─── 4. Quarterly deadline check ─────────────────────────────────────
  const nextDeadline = getNextQuarterlyDeadline();
  let quarterlyAlert = null;
  if (QUARTERLY_ALERTS && nextDeadline.daysUntil <= 30 && ytdPnl > 500) {
    const estQuarterlyTax = ytdPnl > 0
      ? estimateTaxOnGain(ytdPnl, { taxCategory: 'short_term_capital' }, totalIncome, FILING_STATUS)
      : { taxOwed: 0 };
    quarterlyAlert = {
      deadline: nextDeadline,
      estimatedPayment: Math.round(estQuarterlyTax.taxOwed / 4 * 100) / 100,
      message: `Quarterly estimated tax (${nextDeadline.q}) due ${nextDeadline.date} (${nextDeadline.daysUntil} days). Estimated payment: ~$${(estQuarterlyTax.taxOwed / 4).toFixed(2)}`,
    };
  }

  // ─── 5. Build optimization recommendations ──────────────────────────
  const recommendations = [];

  // 1256 preference
  if (venuePreference.savings1256PerHundred > 2) {
    recommendations.push({
      priority: 'high',
      action: 'prefer_1256_instruments',
      savingsPerHundred: venuePreference.savings1256PerHundred,
      detail: `Route trades through futures when edge is comparable. Saves $${venuePreference.savings1256PerHundred}/per $100 gain (${venuePreference.shortTermRate}% spot vs ${venuePreference.section1256Rate}% futures)`,
    });
  }

  // Loss harvesting
  if (harvestOpportunities.length > 0) {
    const totalHarvestable = harvestOpportunities.reduce((s, o) => s + Math.abs(o.loss), 0);
    recommendations.push({
      priority: 'medium',
      action: 'harvest_losses',
      totalHarvestable: Math.round(totalHarvestable * 100) / 100,
      opportunities: harvestOpportunities.length,
      detail: `$${totalHarvestable.toFixed(2)} in harvestable losses across ${harvestOpportunities.length} positions`,
    });
  }

  // Entity optimization
  if (ENTITY_TYPE === 'individual' && ytdPnl > 50000) {
    recommendations.push({
      priority: 'high',
      action: 'consider_entity_election',
      detail: 'Trading income exceeds $50K — LLC or S-Corp election could save on SE tax and enable business deductions',
    });
  }

  // Year-end 1256 mark-to-market reminder
  const now = new Date();
  if (now.getMonth() >= 10) { // November or December
    recommendations.push({
      priority: 'medium',
      action: 'year_end_1256_review',
      detail: 'Year-end approaching: all §1256 positions are marked-to-market on Dec 31 regardless of whether closed. Consider closing losers before year-end for harvesting.',
    });
  }

  // ─── 6. Publish to signal bus ────────────────────────────────────────
  try {
    const bus = require('../lib/agent-signal-bus');
    bus.publish({
      type: 'tax_optimization',
      source: 'tax-advisor-agent',
      confidence: 0.85,
      payload: {
        filingStatus: FILING_STATUS,
        entityType: ENTITY_TYPE,
        state: STATE,
        ytdPnl: Math.round(ytdPnl * 100) / 100,
        totalIncome: Math.round(totalIncome),
        classifications,
        venuePreference,
        taxEstimates,
        recommendations,
        harvestOpportunities: harvestOpportunities.length,
        quarterlyDeadline: nextDeadline,
        entityGuidance: entity.notes,
        analysisAt: new Date().toISOString(),
      },
      ttlMs: 12 * 60 * 60 * 1000, // 12 hours
    });
    console.log('[tax-advisor] Published tax_optimization signal to bus');
  } catch (busErr) {
    logger.warn('Signal bus unavailable', { error: busErr?.message });
  }

  // ─── 7. Build summary report ─────────────────────────────────────────
  const lines = [
    `=== Tax Advisor Report ===`,
    `Filing: ${FILING_STATUS} | Entity: ${ENTITY_TYPE} | State: ${STATE || 'N/A'}`,
    `YTD Trading P&L: $${ytdPnl.toFixed(2)} | Total Est. Income: $${totalIncome.toFixed(0)}`,
    ``,
    `--- Income by Tax Category ---`,
  ];

  for (const [cat, info] of Object.entries(classifications)) {
    lines.push(`  ${cat}: ${info.count} trades, $${info.totalPnl.toFixed(2)} (${info.treatment})`);
  }

  lines.push('');
  lines.push('--- Effective Tax Rates ---');
  lines.push(`  Spot/Short-term: ${venuePreference.shortTermRate}%`);
  lines.push(`  Section 1256:    ${venuePreference.section1256Rate}%`);
  lines.push(`  Long-term:       ${venuePreference.longTermRate}%`);
  lines.push(`  1256 savings:    $${venuePreference.savings1256PerHundred} per $100 gain`);

  if (recommendations.length > 0) {
    lines.push('');
    lines.push('--- Recommendations ---');
    for (const rec of recommendations) {
      lines.push(`  [${rec.priority.toUpperCase()}] ${rec.detail}`);
    }
  }

  if (entity.notes.length > 0) {
    lines.push('');
    lines.push('--- Entity Structure Notes ---');
    for (const note of entity.notes) {
      lines.push(`  * ${note}`);
    }
  }

  if (quarterlyAlert) {
    lines.push('');
    lines.push(`--- Quarterly Alert ---`);
    lines.push(`  ${quarterlyAlert.message}`);
  }

  if (harvestOpportunities.length > 0) {
    lines.push('');
    lines.push('--- Tax-Loss Harvest Opportunities ---');
    for (const opp of harvestOpportunities.slice(0, 5)) {
      lines.push(`  ${opp.recommendation}`);
    }
  }

  lines.push('');
  lines.push(`Next quarterly deadline: ${nextDeadline.q} ${nextDeadline.date} (${nextDeadline.daysUntil} days)`);

  const report = lines.join('\n');
  console.log(report);

  // Send alert if quarterly deadline is close or significant recommendations
  if (quarterlyAlert || recommendations.some(r => r.priority === 'high')) {
    await sendAlert(report);
  }

  console.log('[tax-advisor] Analysis complete');
}

// ─── Exports for use by other modules ───────────────────────────────────────────
module.exports = { classifyTrade, estimateTaxOnGain, computeVenuePreference, findHarvestOpportunities };

if (require.main === module) {
  main().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[tax-advisor] Fatal: ${message}`);
    try { await sendAlert(`Tax advisor failed: ${message}`); } catch {}
    process.exit(1);
  });
}
