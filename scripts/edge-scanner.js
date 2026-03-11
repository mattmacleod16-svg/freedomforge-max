#!/usr/bin/env node

/**
 * Edge Scanner — Autonomous multi-asset opportunity discovery agent.
 *
 * Continuously scans a configurable list of assets for trading edges
 * using the composite signal engine. Publishes high-confidence opportunities
 * to the signal bus so trading engines can consume them.
 *
 * Also runs strategy evolution checks and publishes performance signals.
 *
 * Designed to run as a systemd timer or cron job every 5-15 minutes.
 */

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const SCAN_ASSETS = String(process.env.EDGE_SCAN_ASSETS || 'BTC,ETH,SOL,DOGE,AVAX,LINK,XRP,ARB,OP')
  .split(',')
  .map((a) => a.trim().toUpperCase())
  .filter(Boolean);
const MIN_EDGE_TO_PUBLISH = Math.max(0.05, Number(process.env.EDGE_SCAN_MIN_EDGE || 0.15));
const MIN_CONFIDENCE_TO_PUBLISH = Math.max(0.5, Number(process.env.EDGE_SCAN_MIN_CONFIDENCE || 0.55));
const TOP_OPPORTUNITIES = Math.max(1, parseInt(process.env.EDGE_SCAN_TOP_N || '5', 10));
const ENABLE_STRATEGY_EVOLUTION = String(process.env.EDGE_SCAN_STRATEGY_EVOLUTION || 'true').toLowerCase() !== 'false';
const ALERT_WEBHOOK_URL = (process.env.ALERT_WEBHOOK_URL || '').trim();
const ALERT_ON_HIGH_EDGE = String(process.env.EDGE_SCAN_ALERT_HIGH_EDGE || 'true').toLowerCase() !== 'false';
const HIGH_EDGE_THRESHOLD = Number(process.env.EDGE_SCAN_HIGH_EDGE_THRESHOLD || 0.35);

let edgeDetector, signalBus, tradeJournal, brain, riskManager;
try { edgeDetector = require('../lib/edge-detector'); } catch (e) { console.error('edge-detector not available:', e.message); process.exit(1); }
try { signalBus = require('../lib/agent-signal-bus'); } catch (e) { console.error('signal-bus not available:', e.message); process.exit(1); }
try { tradeJournal = require('../lib/trade-journal'); } catch { tradeJournal = null; }
try { brain = require('../lib/self-evolving-brain'); } catch { brain = null; }
try { riskManager = require('../lib/risk-manager'); } catch { riskManager = null; }

async function sendWebhook(content) {
  if (!ALERT_WEBHOOK_URL) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, 1900) }),
      signal: controller.signal,
    });
  } catch (err) {
    console.error('[edge-scanner] webhook delivery failed:', err.message || err);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const startMs = Date.now();
  console.log(`[edge-scanner] Scanning ${SCAN_ASSETS.length} assets: ${SCAN_ASSETS.join(', ')}`);

  // 1. Scan all assets for opportunities (with timeout guard)
  const SCAN_TIMEOUT_MS = Math.max(30000, parseInt(process.env.EDGE_SCAN_TIMEOUT_MS || '120000', 10));
  let opportunities;
  try {
    opportunities = await Promise.race([
      edgeDetector.scanAssets(SCAN_ASSETS, TOP_OPPORTUNITIES * 2),
      new Promise((_, reject) => setTimeout(() => reject(new Error('scanAssets timed out')), SCAN_TIMEOUT_MS)),
    ]);
  } catch (err) {
    console.error('[edge-scanner] scan failed:', err.message);
    process.exit(1);
  }

  // 2. Filter by minimum thresholds
  const publishable = opportunities.filter(
    (o) => o.edge >= MIN_EDGE_TO_PUBLISH && o.confidence >= MIN_CONFIDENCE_TO_PUBLISH
  );

  // 3. Publish to signal bus
  let published = 0;
  for (const opp of publishable.slice(0, TOP_OPPORTUNITIES)) {
    signalBus.publish({
      type: 'edge_opportunity',
      source: 'edge-scanner',
      confidence: opp.confidence,
      payload: {
        asset: opp.asset,
        side: opp.side,
        edge: opp.edge,
        compositeScore: opp.compositeScore,
        dynamicThresholdBps: opp.dynamicThresholdBps,
        rsi: opp.components?.rsi,
        mtfConfluence: opp.components?.multiTfMomentum?.confluence,
        mtfDirection: opp.components?.multiTfMomentum?.direction,
        lastPrice: opp.meta?.lastPrice,
      },
      ttlMs: 30 * 60 * 1000, // 30 min TTL
    });
    published += 1;
  }

  // 4. Publish scan summary signal
  signalBus.publish({
    type: 'edge_scan_summary',
    source: 'edge-scanner',
    confidence: 0.9,
    payload: {
      assetsScanned: SCAN_ASSETS.length,
      opportunitiesFound: opportunities.length,
      publishable: publishable.length,
      published,
      topOpps: publishable.slice(0, 3).map((o) => ({
        asset: o.asset,
        side: o.side,
        edge: Math.round(o.edge * 100) / 100,
        confidence: Math.round(o.confidence * 100) / 100,
      })),
      durationMs: Date.now() - startMs,
    },
    ttlMs: 60 * 60 * 1000,
  });

  // 5. Alert on high-edge opportunities
  const highEdge = publishable.filter((o) => o.edge >= HIGH_EDGE_THRESHOLD);
  if (ALERT_ON_HIGH_EDGE && highEdge.length > 0) {
    const lines = highEdge.map((o) =>
      `**${o.asset}** ${(o.side || 'UNKNOWN').toUpperCase()} | edge: ${(o.edge * 100).toFixed(1)}% | conf: ${(o.confidence * 100).toFixed(1)}% | price: $${Number(o.meta?.lastPrice || 0).toFixed(2) || '?'}`
    );
    await sendWebhook(`🎯 **Edge Scanner — High-Edge Opportunities**\n${lines.join('\n')}`);
  }

  // 6. Strategy evolution check
  let evolution = null;
  if (ENABLE_STRATEGY_EVOLUTION && tradeJournal) {
    try {
      evolution = tradeJournal.getStrategyEvolution();
      signalBus.publish({
        type: 'strategy_evolution',
        source: 'edge-scanner',
        confidence: 0.8,
        payload: {
          winRate: evolution.stats.winRate,
          pnl: evolution.stats.totalPnl,
          sharpe: evolution.stats.sharpeRatio,
          maxDD: evolution.stats.maxDrawdown,
          trades: evolution.stats.closedTrades,
          recommendations: evolution.recommendations,
        },
        ttlMs: 4 * 60 * 60 * 1000,
      });
    } catch (err) {
      console.error('[edge-scanner] strategy evolution check failed:', err.message || err);
    }
  }

  // 7. Output summary
  const result = {
    ts: new Date().toISOString(),
    scanner: 'edge-scanner',
    assetsScanned: SCAN_ASSETS.length,
    totalOpportunities: opportunities.length,
    publishedSignals: published,
    durationMs: Date.now() - startMs,
    topOpportunities: publishable.slice(0, TOP_OPPORTUNITIES).map((o) => ({
      asset: o.asset,
      side: o.side,
      confidence: Math.round(o.confidence * 1000) / 1000,
      edge: Math.round(o.edge * 1000) / 1000,
      compositeScore: Math.round(o.compositeScore * 1000) / 1000,
      price: o.meta?.lastPrice,
      rsi: o.components?.rsi ? Math.round(o.components.rsi) : null,
      mtfConfluence: o.components?.multiTfMomentum?.confluence,
    })),
    allScanned: opportunities.map((o) => ({
      asset: o.asset,
      side: o.side,
      edge: Math.round(o.edge * 100) / 100,
      conf: Math.round(o.confidence * 100) / 100,
    })),
    strategyEvolution: evolution ? {
      winRate: evolution.stats.winRate,
      pnl: evolution.stats.totalPnl,
      recommendations: evolution.recommendations,
    } : null,
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('[edge-scanner] Fatal:', err.message);
  process.exit(1);
});
