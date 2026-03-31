/**
 * NEXUS Feedback Loop — Closes the learning cycle.
 *
 * After every trade closes, this module:
 *   1. Attributes the PnL to the signal components that were active
 *   2. Updates the brain's weights based on which factors were correct
 *   3. Updates the ML pipeline with the labeled sample
 *   4. Updates Kelly calibration with the real outcome
 *   5. Publishes a learning event to the signal bus
 *
 * This is what makes the brain actually LEARN from the market, not just
 * from its own past guesses.
 */

'use strict';

let brain, mlPipeline, kellySizer, signalBus, tradeJournal;
try { brain       = require('./self-evolving-brain'); } catch {}
try { mlPipeline  = require('./ml-pipeline');          } catch {}
try { kellySizer  = require('./kelly-sizer');           } catch {}
try { signalBus   = require('./agent-signal-bus');      } catch {}
try { tradeJournal = require('./trade-journal');        } catch {}

let log;
try { const { createLogger } = require('./logger'); log = createLogger('nexus-feedback'); }
catch { log = { info: console.log, warn: console.warn, error: console.error }; }

/**
 * Call this every time a trade closes with a real PnL.
 * @param {object} outcome
 * @param {string} outcome.asset
 * @param {string} outcome.side  'buy'|'sell'
 * @param {number} outcome.entryPrice
 * @param {number} outcome.exitPrice
 * @param {number} outcome.pnlUsd
 * @param {number} outcome.pnlPct
 * @param {object} outcome.signalComponents  — from edge-detector output
 * @param {number} outcome.confidence
 * @param {string} outcome.venue
 */
async function recordTradeOutcome(outcome) {
  const { asset, side, pnlUsd, pnlPct, confidence, signalComponents = {} } = outcome;
  const won = pnlUsd > 0;

  log.info(`Recording outcome: ${asset} ${side} pnl=$${pnlUsd.toFixed(2)} (${won ? 'WIN' : 'LOSS'})`);

  // 1. Feed to self-evolving brain
  if (brain && typeof brain.recordOutcome === 'function') {
    try {
      brain.recordOutcome({
        asset, side, won, pnlPct,
        confidence,
        indicators: signalComponents,
        timestamp: Date.now(),
      });
    } catch (e) { log.warn('brain.recordOutcome failed:', e.message); }
  }

  // 2. Feed to ML pipeline
  if (mlPipeline && typeof mlPipeline.recordOutcome === 'function') {
    try {
      mlPipeline.recordOutcome({
        signal: { side, confidence, compositeScore: won ? confidence : -confidence },
        components: signalComponents,
        outcome: { won, pnlPct },
      });
    } catch (e) { log.warn('mlPipeline.recordOutcome failed:', e.message); }
  }

  // 3. Feed to Kelly calibrator
  if (kellySizer && typeof kellySizer.recordOutcome === 'function') {
    try {
      kellySizer.recordOutcome({ won, pnlPct: Math.abs(pnlPct), side });
    } catch (e) { log.warn('kellySizer.recordOutcome failed:', e.message); }
  }

  // 4. Publish learning event
  if (signalBus) {
    signalBus.publish({
      type: 'trade_outcome',
      source: 'nexus-feedback',
      confidence: 0.9,
      ttl: 24 * 60 * 60 * 1000,
      payload: { asset, side, won, pnlUsd, pnlPct, confidence, timestamp: Date.now() },
    });
  }

  // 5. Attribute NEXUS component performance
  if (signalComponents.nexusBrain) {
    const nb = signalComponents.nexusBrain;
    const nexusCorrect = (nb.side === 'buy' && won && side === 'buy') || (nb.side === 'sell' && won && side === 'sell');
    log.info(`NEXUS attribution: ${asset} — nexus_side=${nb.side} trade_won=${won} nexus_correct=${nexusCorrect}`);
    if (signalBus) {
      signalBus.publish({
        type: 'nexus_attribution',
        source: 'nexus-feedback',
        confidence: 0.85,
        ttl: 24 * 60 * 60 * 1000,
        payload: { asset, nexusCorrect, fearGreed: nb.fearGreed, fundingRate: nb.fundingRate, lsRatio: nb.lsRatio, pnlUsd },
      });
    }
  }
}

module.exports = { recordTradeOutcome };
