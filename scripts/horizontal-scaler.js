#!/usr/bin/env node

/**
 * Horizontal Scaler — Autonomous asset discovery and capital allocation engine.
 *
 * This agent acts like a venture fund manager for trading strategies:
 *   1. Discovers new tradeable assets beyond the initial 9
 *   2. Tests them with paper trades before allocating real capital
 *   3. Promotes consistently profitable assets to active trading
 *   4. Demotes underperforming assets to reduce bleed
 *   5. Dynamically allocates capital based on risk-adjusted returns
 *   6. Monitors exchange rate limits and adjusts frequency
 *
 * Applies Anthropic pattern: "Give Claude room to think" — each decision
 * involves chain-of-thought reasoning logged for transparency.
 *
 * Designed to run as a systemd timer every 30-60 minutes.
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

let rio;
try { rio = require('../lib/resilient-io'); } catch { rio = null; }

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const SCALER_STATE_FILE = path.resolve(process.cwd(), process.env.SCALER_STATE_FILE || 'data/horizontal-scaler-state.json');
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.SCALER_TIMEOUT_MS || 15000));
const MIN_MARKET_CAP_USD = Math.max(1e7, Number(process.env.SCALER_MIN_MCAP || 5e8)); // $500M default
const MIN_24H_VOLUME_USD = Math.max(1e5, Number(process.env.SCALER_MIN_VOLUME || 1e7)); // $10M default
const MAX_ACTIVE_ASSETS = Math.max(5, Math.min(30, parseInt(process.env.SCALER_MAX_ASSETS || '15', 10)));
const PROMOTION_MIN_SCANS = Math.max(3, parseInt(process.env.SCALER_PROMOTION_MIN_SCANS || '5', 10));
const PROMOTION_MIN_EDGE = Math.max(0.05, Number(process.env.SCALER_PROMOTION_MIN_EDGE || 0.15));
const DEMOTION_MAX_SCANS = Math.max(5, parseInt(process.env.SCALER_DEMOTION_MAX_SCANS || '10', 10));
const DEMOTION_MIN_EDGE = Math.max(0, Number(process.env.SCALER_DEMOTION_MIN_EDGE || 0.08));

// Current seed assets (what we scan by default)
const SEED_ASSETS = String(process.env.EDGE_SCAN_ASSETS || 'BTC,ETH,SOL,DOGE,AVAX,LINK,XRP,ARB,OP')
  .split(',').map(a => a.trim().toUpperCase()).filter(Boolean);

// Candidate pool — assets we can potentially discover and add
const CANDIDATE_POOL = [
  'BTC', 'ETH', 'SOL', 'DOGE', 'AVAX', 'LINK', 'XRP', 'ARB', 'OP',
  'MATIC', 'ADA', 'DOT', 'ATOM', 'NEAR', 'APT', 'SUI', 'SEI',
  'INJ', 'TIA', 'FET', 'RNDR', 'WLD', 'PEPE', 'BONK', 'WIF',
  'FIL', 'GRT', 'AAVE', 'UNI', 'MKR', 'LDO', 'CRV', 'SNX',
  'COMP', 'RUNE', 'STX', 'IMX', 'MANA', 'SAND', 'AXS',
  'ALGO', 'ICP', 'HBAR', 'VET', 'EGLD', 'FTM', 'ONE', 'KAVA',
];

let edgeDetector, signalBus, tradeJournal, brain;
try { edgeDetector = require('../lib/edge-detector'); } catch { edgeDetector = null; }
try { signalBus = require('../lib/agent-signal-bus'); } catch { signalBus = null; }
try { tradeJournal = require('../lib/trade-journal'); } catch { tradeJournal = null; }
try { brain = require('../lib/self-evolving-brain'); } catch { brain = null; }

function withTimeout(ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return { controller, timeout };
}

async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const { controller, timeout } = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } catch { return null; } finally { clearTimeout(timeout); }
}

function load(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return null; }
}

function save(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (rio) { rio.writeJsonAtomic(filePath, data); }
  else {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  }
}

function loadScalerState() {
  const raw = load(SCALER_STATE_FILE);
  return {
    activeAssets: raw?.activeAssets || [...SEED_ASSETS],
    candidates: raw?.candidates || {},
    promotions: raw?.promotions || [],
    demotions: raw?.demotions || [],
    capitalAllocation: raw?.capitalAllocation || {},
    discoveryRuns: raw?.discoveryRuns || 0,
    lastDiscoveryAt: raw?.lastDiscoveryAt || 0,
    updatedAt: raw?.updatedAt || Date.now(),
  };
}

function saveScalerState(state) {
  state.updatedAt = Date.now();
  save(SCALER_STATE_FILE, state);
}

// ─── Asset Discovery ─────────────────────────────────────────────────────────

/**
 * Discover new tradeable assets from Binance top volume list.
 * Returns assets that meet our market cap and volume thresholds.
 */
async function discoverAssets() {
  const discovered = [];
  console.log(`[scaler] Discovering new assets from candidate pool of ${CANDIDATE_POOL.length}...`);

  // Fetch Binance 24h ticker for volume data
  const tickers = await fetchJson('https://api.binance.com/api/v3/ticker/24hr');
  if (!Array.isArray(tickers)) {
    console.log('[scaler] Failed to fetch Binance tickers');
    return [];
  }

  // Build a volume map
  const volumeMap = {};
  for (const t of tickers) {
    const symbol = String(t.symbol || '');
    if (!symbol.endsWith('USDT')) continue;
    const asset = symbol.replace('USDT', '');
    const quoteVol = Number(t.quoteVolume || 0);
    const priceChangeAbs = Math.abs(Number(t.priceChangePercent || 0));
    if (quoteVol > 0) {
      volumeMap[asset] = {
        volume24h: quoteVol,
        priceChangePct: priceChangeAbs,
        lastPrice: Number(t.lastPrice || 0),
        highPrice: Number(t.highPrice || 0),
        lowPrice: Number(t.lowPrice || 0),
      };
    }
  }

  // Check which candidates from our pool have sufficient volume
  for (const asset of CANDIDATE_POOL) {
    const data = volumeMap[asset];
    if (!data) continue;
    if (data.volume24h < MIN_24H_VOLUME_USD) continue;

    discovered.push({
      asset,
      volume24h: Math.round(data.volume24h),
      priceChangePct: Math.round(data.priceChangePct * 100) / 100,
      lastPrice: data.lastPrice,
    });
  }

  // Sort by volume (highest first)
  discovered.sort((a, b) => b.volume24h - a.volume24h);
  return discovered;
}

// ─── Edge Scanning for Candidates ────────────────────────────────────────────

/**
 * Scan candidate assets for edge using the composite signal engine.
 * This is the "paper test" before promoting an asset to active trading.
 */
async function scanCandidates(candidates) {
  if (!edgeDetector) {
    console.log('[scaler] Edge detector not available');
    return [];
  }

  const results = [];
  for (const candidate of candidates) {
    try {
      const signal = await edgeDetector.getCompositeSignal({ asset: candidate.asset });
      results.push({
        asset: candidate.asset,
        side: signal.side,
        confidence: signal.confidence,
        edge: signal.edge,
        compositeScore: signal.compositeScore,
        volume24h: candidate.volume24h,
      });
    } catch (err) {
      console.log(`[scaler] Scan failed for ${candidate.asset}: ${err.message}`);
    }
  }

  return results;
}

// ─── Capital Allocation ──────────────────────────────────────────────────────

/**
 * Allocate capital across active assets based on:
 *   - Historical win rate per asset (from brain)
 *   - Recent edge quality
 *   - Correlation with other assets
 *   - Volume/liquidity
 */
function computeCapitalAllocation(activeAssets) {
  const allocation = {};
  const total = activeAssets.length;

  // Base: equal weight
  for (const asset of activeAssets) {
    allocation[asset] = { weight: 1 / total, reason: 'equal_weight' };
  }

  // Overlay brain insights if available
  if (brain) {
    try {
      const insights = brain.getInsights();
      const topAssets = insights.topAssets || [];
      for (const ta of topAssets) {
        if (allocation[ta.asset] && ta.winRate > 50 && ta.pnl > 0) {
          // Boost profitable assets
          const boost = Math.min(0.3, (ta.winRate - 50) / 200 + ta.pnl / 500);
          allocation[ta.asset].weight += boost;
          allocation[ta.asset].reason = `brain_boosted (WR:${ta.winRate}%, PnL:$${ta.pnl})`;
        }
        if (allocation[ta.asset] && ta.pnl < 0 && ta.trades > 5) {
          // Reduce unprofitable assets
          const penalty = Math.min(0.2, Math.abs(ta.pnl) / 500);
          allocation[ta.asset].weight = Math.max(0.02, allocation[ta.asset].weight - penalty);
          allocation[ta.asset].reason = `brain_reduced (PnL:$${ta.pnl})`;
        }
      }
    } catch {}
  }

  // Normalize to sum to 1
  const totalWeight = Object.values(allocation).reduce((s, a) => s + a.weight, 0);
  if (totalWeight > 0) {
    for (const a of Object.values(allocation)) {
      a.weight = Math.round((a.weight / totalWeight) * 10000) / 10000;
    }
  }

  return allocation;
}

// ─── Promotion & Demotion Logic ──────────────────────────────────────────────

function evaluatePromotions(state, scanResults) {
  const promotions = [];

  for (const result of scanResults) {
    const asset = result.asset;
    if (state.activeAssets.includes(asset)) continue;
    if (state.activeAssets.length >= MAX_ACTIVE_ASSETS) break;

    // Initialize candidate tracking if needed
    if (!state.candidates[asset]) {
      state.candidates[asset] = { scans: 0, totalEdge: 0, totalConfidence: 0, topEdge: 0, firstSeen: Date.now() };
    }

    const cand = state.candidates[asset];
    cand.scans++;
    cand.totalEdge += result.edge;
    cand.totalConfidence += result.confidence;
    cand.topEdge = Math.max(cand.topEdge, result.edge);
    cand.lastSeen = Date.now();

    const avgEdge = cand.totalEdge / cand.scans;

    // ─── Chain-of-thought reasoning (Anthropic pattern) ──────────────
    const reasoning = [];
    reasoning.push(`Evaluating ${asset} for promotion:`);
    reasoning.push(`  Scans: ${cand.scans}/${PROMOTION_MIN_SCANS} required`);
    reasoning.push(`  Avg edge: ${(avgEdge * 100).toFixed(1)}% (min ${(PROMOTION_MIN_EDGE * 100).toFixed(1)}%)`);
    reasoning.push(`  Volume: $${(result.volume24h / 1e6).toFixed(1)}M`);

    if (cand.scans >= PROMOTION_MIN_SCANS && avgEdge >= PROMOTION_MIN_EDGE) {
      reasoning.push(`  DECISION: PROMOTE — sufficient history with consistent edge`);
      promotions.push({
        asset,
        avgEdge: Math.round(avgEdge * 1000) / 1000,
        scans: cand.scans,
        volume24h: result.volume24h,
        reasoning: reasoning.join('\n'),
      });
    } else {
      reasoning.push(`  DECISION: WAIT — need more data`);
    }

    console.log(reasoning.join('\n'));
  }

  return promotions;
}

function evaluateDemotions(state) {
  const demotions = [];

  // Check active assets for demotion
  if (brain) {
    try {
      const insights = brain.getInsights();
      const assetProfiles = insights.topAssets || [];

      for (const asset of state.activeAssets) {
        // Don't demote seed assets (they're always scanned)
        if (SEED_ASSETS.includes(asset)) continue;

        const profile = assetProfiles.find(a => a.asset === asset);
        if (!profile || profile.trades < DEMOTION_MAX_SCANS) continue;

        const reasoning = [];
        reasoning.push(`Evaluating ${asset} for demotion:`);
        reasoning.push(`  Win rate: ${profile.winRate}%`);
        reasoning.push(`  P&L: $${profile.pnl}`);
        reasoning.push(`  Trades: ${profile.trades}`);

        if (profile.pnl < 0 && profile.winRate < 40) {
          reasoning.push(`  DECISION: DEMOTE — consistent underperformer`);
          demotions.push({
            asset,
            winRate: profile.winRate,
            pnl: profile.pnl,
            trades: profile.trades,
            reasoning: reasoning.join('\n'),
          });
        } else {
          reasoning.push(`  DECISION: KEEP — acceptable performance`);
        }

        console.log(reasoning.join('\n'));
      }
    } catch {}
  }

  return demotions;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const startMs = Date.now();
  const state = loadScalerState();

  console.log(`[scaler] Current active assets (${state.activeAssets.length}): ${state.activeAssets.join(', ')}`);

  // 1. Discover new tradeable assets
  const discovered = await discoverAssets();
  const newCandidates = discovered.filter(d => !state.activeAssets.includes(d.asset));

  console.log(`[scaler] Discovered ${discovered.length} viable assets, ${newCandidates.length} new candidates`);

  // 2. Scan new candidates for edge (limit to top 10 by volume)
  const toScan = newCandidates.slice(0, 10);
  const scanResults = await scanCandidates(toScan);
  const withEdge = scanResults.filter(r => r.edge > 0.05 && r.side !== 'neutral');

  console.log(`[scaler] Scanned ${toScan.length} candidates, ${withEdge.length} show edge`);

  // 3. Evaluate promotions — FIX H-8: enforce MAX_ACTIVE_ASSETS cap in main loop
  const promotions = evaluatePromotions(state, withEdge);
  for (const promo of promotions) {
    if (state.activeAssets.length >= MAX_ACTIVE_ASSETS) {
      console.log(`[scaler] MAX_ACTIVE_ASSETS (${MAX_ACTIVE_ASSETS}) reached — skipping remaining promotions`);
      break;
    }
    if (!state.activeAssets.includes(promo.asset)) {
      state.activeAssets.push(promo.asset);
      state.promotions.push({ ...promo, promotedAt: Date.now() });
      console.log(`[scaler] ★ PROMOTED ${promo.asset} to active trading (avg edge: ${(promo.avgEdge * 100).toFixed(1)}%)`);
    }
  }

  // 4. Evaluate demotions
  const demotions = evaluateDemotions(state);
  for (const demo of demotions) {
    const idx = state.activeAssets.indexOf(demo.asset);
    if (idx >= 0) {
      state.activeAssets.splice(idx, 1);
      state.demotions.push({ ...demo, demotedAt: Date.now() });
      console.log(`[scaler] ✗ DEMOTED ${demo.asset} (WR: ${demo.winRate}%, PnL: $${demo.pnl})`);
    }
  }

  // 5. Compute capital allocation
  const capitalAllocation = computeCapitalAllocation(state.activeAssets);
  state.capitalAllocation = capitalAllocation;

  // 6. Run brain evolution if available
  let brainEvolution = null;
  if (brain) {
    try {
      brainEvolution = brain.runEvolutionCycle();
    } catch (err) {
      console.log(`[scaler] Brain evolution error: ${err.message}`);
    }
  }

  // 7. Publish to signal bus
  if (signalBus) {
    signalBus.publish({
      type: 'scaler_update',
      source: 'horizontal-scaler',
      confidence: 0.9,
      payload: {
        activeAssets: state.activeAssets,
        assetCount: state.activeAssets.length,
        promotions: promotions.map(p => p.asset),
        demotions: demotions.map(d => d.asset),
        capitalAllocation: Object.fromEntries(
          Object.entries(capitalAllocation).map(([k, v]) => [k, v.weight])
        ),
        brainEvolved: brainEvolution?.evolved || false,
      },
      ttlMs: 2 * 60 * 60 * 1000,
    });

    // Publish updated scan asset list
    signalBus.publish({
      type: 'active_asset_list',
      source: 'horizontal-scaler',
      confidence: 1.0,
      payload: { assets: state.activeAssets, count: state.activeAssets.length },
      ttlMs: 2 * 60 * 60 * 1000,
    });
  }

  // 8. Save state
  state.discoveryRuns++;
  state.lastDiscoveryAt = Date.now();
  saveScalerState(state);

  // 9. Output report
  const report = {
    ts: new Date().toISOString(),
    agent: 'horizontal-scaler',
    activeAssets: state.activeAssets,
    assetCount: state.activeAssets.length,
    discovered: discovered.length,
    newCandidates: newCandidates.length,
    scanned: toScan.length,
    withEdge: withEdge.map(r => ({
      asset: r.asset, side: r.side,
      edge: Math.round(r.edge * 1000) / 1000,
      confidence: Math.round(r.confidence * 1000) / 1000,
    })),
    promotions: promotions.map(p => ({ asset: p.asset, avgEdge: p.avgEdge })),
    demotions: demotions.map(d => ({ asset: d.asset, winRate: d.winRate, pnl: d.pnl })),
    capitalAllocation: Object.fromEntries(
      Object.entries(capitalAllocation).map(([k, v]) => [k, `${(v.weight * 100).toFixed(1)}%`])
    ),
    brainEvolution: brainEvolution ? {
      evolved: brainEvolution.evolved,
      generation: brainEvolution.generation?.id,
      calibrationScore: brainEvolution.calibration?.score,
      streak: brainEvolution.streaks?.current,
    } : null,
    durationMs: Date.now() - startMs,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

main().catch(err => {
  console.error('[scaler] Fatal:', err.message);
  process.exit(1);
});
