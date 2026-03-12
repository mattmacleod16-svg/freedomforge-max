#!/usr/bin/env node

/**
 * MultiversX Engine — Automated EGLD/ESDT trading, staking & yield on MultiversX.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Capabilities:
 *  - EGLD staking delegation for passive yield (~7-10% APY)
 *  - xExchange liquidity pair monitoring
 *  - Hatom/AshSwap DeFi yield opportunities
 *  - Portfolio rebalancing across EGLD + ESDT tokens
 *  - Auto-claim staking rewards
 *  - Price monitoring + signal bus integration
 *
 * NOTE: Add to venue-engine.js map:
 *   multiversx: ['node', ['scripts/multiversx-engine.js']]
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createLogger } = require('../lib/logger');
const log = createLogger('mvx-engine');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

// ─── Configuration ──────────────────────────────────────────────────────────

const ENABLED = String(process.env.MVX_ENABLED || 'false').toLowerCase() === 'true';
const DRY_RUN = String(process.env.MVX_DRY_RUN || 'true').toLowerCase() !== 'false';
const MIN_STAKE_EGLD = Math.max(1, Number(process.env.MVX_MIN_STAKE_EGLD || 1));
const MAX_STAKE_PCT = Math.max(0.05, Math.min(0.80, Number(process.env.MVX_MAX_STAKE_PCT || 0.50)));
const MIN_BALANCE_EGLD = Math.max(0.05, Number(process.env.MVX_MIN_BALANCE_EGLD || 0.5));
const AUTO_CLAIM_REWARDS = String(process.env.MVX_AUTO_CLAIM_REWARDS || 'true').toLowerCase() === 'true';
const AUTO_STAKE_IDLE = String(process.env.MVX_AUTO_STAKE_IDLE || 'false').toLowerCase() === 'true';
const PREFERRED_VALIDATOR = (process.env.MVX_PREFERRED_VALIDATOR || '').trim();
const CHECK_INTERVAL_SEC = Math.max(60, Number(process.env.MVX_CHECK_INTERVAL_SEC || 3600));
const STATE_FILE = process.env.MVX_STATE_FILE || 'data/multiversx-state.json';
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.MVX_TIMEOUT_MS || 15000));

// ─── Optional Library Imports ───────────────────────────────────────────────

let MultiversXClient;
try { ({ MultiversXClient } = require('../lib/multiversx/client')); } catch { MultiversXClient = null; }

let capitalMandate;
try { capitalMandate = require('../lib/capital-mandate'); } catch { capitalMandate = null; }

let riskManager;
try { riskManager = require('../lib/risk-manager'); } catch { riskManager = null; }

let rio;
try { rio = require('../lib/resilient-io'); } catch { rio = null; }

let signalBus;
try { signalBus = require('../lib/agent-signal-bus'); } catch { signalBus = null; }

let tradeJournal;
try { tradeJournal = require('../lib/trade-journal'); } catch { tradeJournal = null; }

let treasuryLedger;
try { treasuryLedger = require('../lib/treasury-ledger'); } catch { treasuryLedger = null; }

// ─── State Management ───────────────────────────────────────────────────────

function loadState() {
  const abs = path.resolve(process.cwd(), STATE_FILE);
  if (rio) {
    const data = rio.readJsonSafe(abs, { fallback: null });
    return { path: abs, data: data || createDefaultState() };
  }
  if (!fs.existsSync(abs)) return { path: abs, data: createDefaultState() };
  try {
    return { path: abs, data: JSON.parse(fs.readFileSync(abs, 'utf8')) };
  } catch {
    return { path: abs, data: createDefaultState() };
  }
}

function createDefaultState() {
  return {
    lastRunAt: 0,
    lastClaimAt: 0,
    totalStaked: 0,
    totalClaimed: 0,
    totalYield: 0,
    cycles: 0,
    errors: 0,
    portfolioSnapshots: [],
    stakingHistory: [],
    claimHistory: [],
  };
}

function saveState(st) {
  try {
    if (rio) {
      rio.writeJsonSafe(st.path, st.data);
    } else {
      fs.writeFileSync(st.path, JSON.stringify(st.data, null, 2));
    }
  } catch (err) {
    log.error('Failed to save state', { error: err.message });
  }
}

// ─── Kill Switch Check ─────────────────────────────────────────────────────

function isKillSwitchActive() {
  try {
    const killPath = path.resolve(process.cwd(), 'data/kill-switch.json');
    if (!fs.existsSync(killPath)) return false;
    const ks = JSON.parse(fs.readFileSync(killPath, 'utf8'));
    return ks?.active === true;
  } catch { return false; }
}

// ─── Core Engine ────────────────────────────────────────────────────────────

async function runCycle() {
  if (!ENABLED) {
    log.info('MultiversX engine disabled (MVX_ENABLED=false)');
    return { skipped: true, reason: 'disabled' };
  }

  if (!MultiversXClient) {
    log.error('MultiversX client not available');
    return { skipped: true, reason: 'client_unavailable' };
  }

  if (isKillSwitchActive()) {
    log.warn('Kill switch active — skipping MultiversX cycle');
    return { skipped: true, reason: 'kill_switch' };
  }

  const st = loadState();
  const now = Date.now();

  // Rate limit
  if (st.data.lastRunAt && (now - st.data.lastRunAt) < CHECK_INTERVAL_SEC * 1000) {
    const waitSec = Math.ceil((st.data.lastRunAt + CHECK_INTERVAL_SEC * 1000 - now) / 1000);
    log.info(`Cooldown active, ${waitSec}s remaining`);
    return { skipped: true, reason: 'cooldown', waitSec };
  }

  const client = new MultiversXClient();
  const result = {
    timestamp: new Date().toISOString(),
    portfolio: null,
    staking: null,
    rewards: null,
    actions: [],
    errors: [],
  };

  try {
    // 1. Get portfolio value
    log.info('Fetching MultiversX portfolio...');
    const portfolio = await client.getPortfolioValue();
    result.portfolio = {
      totalUSD: portfolio.totalUSD,
      egldBalance: portfolio.egld.balance,
      egldPrice: portfolio.egld.price,
      egldValueUSD: portfolio.egld.valueUSD,
      tokenCount: portfolio.tokens.length,
      topTokens: portfolio.tokens
        .sort((a, b) => (b.valueUSD || 0) - (a.valueUSD || 0))
        .slice(0, 5)
        .map(t => ({ ticker: t.ticker, balance: t.balanceHuman, valueUSD: t.valueUSD })),
    };

    log.info('Portfolio loaded', {
      totalUSD: portfolio.totalUSD.toFixed(2),
      egld: portfolio.egld.balance.toFixed(4),
      tokens: portfolio.tokens.length,
    });

    // Publish portfolio signal
    if (signalBus) {
      signalBus.publish({
        type: 'portfolio_update',
        source: 'multiversx',
        data: { totalUSD: portfolio.totalUSD, egldBalance: portfolio.egld.balance },
      });
    }

    // 2. Check staking positions
    log.info('Checking staking positions...');
    const staking = await client.getStakingPositions();
    result.staking = staking.map(s => ({
      validator: s.contract,
      staked: s.userActiveStakeEGLD,
      rewards: s.claimableRewardsEGLD,
    }));

    const totalStaked = staking.reduce((sum, s) => sum + s.userActiveStakeEGLD, 0);
    const totalRewards = staking.reduce((sum, s) => sum + s.claimableRewardsEGLD, 0);

    log.info('Staking summary', {
      positions: staking.length,
      totalStakedEGLD: totalStaked.toFixed(4),
      claimableEGLD: totalRewards.toFixed(6),
    });

    // 3. Auto-claim rewards if threshold met
    if (AUTO_CLAIM_REWARDS && totalRewards > 0.01) {
      log.info('Claimable rewards detected', { egld: totalRewards.toFixed(6) });

      for (const pos of staking) {
        if (pos.claimableRewardsEGLD > 0.005) {
          if (DRY_RUN) {
            log.info('[DRY RUN] Would claim rewards', {
              validator: pos.contract,
              rewards: pos.claimableRewardsEGLD.toFixed(6),
            });
            result.actions.push({
              type: 'claim_rewards',
              dryRun: true,
              validator: pos.contract,
              amount: pos.claimableRewardsEGLD,
            });
          } else {
            try {
              const tx = await client.buildClaimRewardsTx(pos.contract);
              log.info('Built claim transaction', { tx });
              result.actions.push({
                type: 'claim_rewards',
                dryRun: false,
                validator: pos.contract,
                amount: pos.claimableRewardsEGLD,
                tx,
              });
              st.data.totalClaimed += pos.claimableRewardsEGLD;
              st.data.lastClaimAt = now;
              st.data.claimHistory.push({
                at: now,
                validator: pos.contract,
                amount: pos.claimableRewardsEGLD,
              });
            } catch (err) {
              log.error('Claim failed', { validator: pos.contract, error: err.message });
              result.errors.push({ action: 'claim', error: err.message });
            }
          }
        }
      }
    }

    // 4. Auto-stake idle EGLD if configured
    if (AUTO_STAKE_IDLE && portfolio.egld.balance > MIN_BALANCE_EGLD + MIN_STAKE_EGLD) {
      const available = portfolio.egld.balance - MIN_BALANCE_EGLD;
      const maxStake = portfolio.egld.balance * MAX_STAKE_PCT;
      const stakeAmount = Math.min(available, maxStake);

      if (stakeAmount >= MIN_STAKE_EGLD) {
        const validator = PREFERRED_VALIDATOR || (staking.length > 0 ? staking[0].contract : null);

        if (validator) {
          if (DRY_RUN) {
            log.info('[DRY RUN] Would delegate EGLD', { amount: stakeAmount.toFixed(4), validator });
            result.actions.push({
              type: 'delegate',
              dryRun: true,
              validator,
              amount: stakeAmount,
            });
          } else {
            try {
              const tx = await client.buildDelegateTx(validator, stakeAmount);
              log.info('Built delegation transaction', { amount: stakeAmount.toFixed(4) });
              result.actions.push({
                type: 'delegate',
                dryRun: false,
                validator,
                amount: stakeAmount,
                tx,
              });
              st.data.totalStaked += stakeAmount;
              st.data.stakingHistory.push({ at: now, validator, amount: stakeAmount });
            } catch (err) {
              log.error('Delegation failed', { error: err.message });
              result.errors.push({ action: 'delegate', error: err.message });
            }
          }
        } else {
          log.info('No validator configured for auto-staking');
        }
      }
    }

    // 5. Check xExchange DEX for opportunities
    log.info('Scanning xExchange pairs...');
    const pairs = await client.getXExchangePairs();
    const mexEcon = await client.getMexEconomics();
    if (pairs && pairs.length > 0) {
      result.dex = {
        pairsAvailable: pairs.length,
        mexTVL: mexEcon?.totalLockedValueUSD || null,
        mexPrice: mexEcon?.price || null,
        topPairs: pairs
          .filter(p => p.state === 'Active')
          .sort((a, b) => (Number(b.lockedValueUSD) || 0) - (Number(a.lockedValueUSD) || 0))
          .slice(0, 10)
          .map(p => ({
            pair: `${p.firstToken?.ticker || '?'}/${p.secondToken?.ticker || '?'}`,
            tvl: p.lockedValueUSD,
          })),
      };
    }

    // 6. Record portfolio snapshot
    st.data.portfolioSnapshots.push({
      at: now,
      totalUSD: portfolio.totalUSD,
      egld: portfolio.egld.balance,
      staked: totalStaked,
      rewards: totalRewards,
    });

    // Keep last 90 snapshots
    if (st.data.portfolioSnapshots.length > 90) {
      st.data.portfolioSnapshots = st.data.portfolioSnapshots.slice(-90);
    }

    // Record to trade journal if available
    if (tradeJournal && result.actions.length > 0) {
      for (const action of result.actions) {
        if (!action.dryRun) {
          tradeJournal.record({
            venue: 'multiversx',
            asset: 'EGLD',
            side: action.type,
            amount: action.amount,
            timestamp: now,
          });
        }
      }
    }

    st.data.lastRunAt = now;
    st.data.cycles += 1;
    st.data.errors += result.errors.length;
    saveState(st);

    const summary = {
      portfolio: result.portfolio?.totalUSD?.toFixed(2) || '?',
      staked: totalStaked.toFixed(4),
      rewards: totalRewards.toFixed(6),
      actions: result.actions.length,
      errors: result.errors.length,
      dryRun: DRY_RUN,
    };

    log.info('MultiversX cycle complete', summary);

    return result;
  } catch (err) {
    log.error('MultiversX engine error', { error: err.message, stack: err.stack?.split('\n')[1] });
    st.data.errors += 1;
    st.data.lastRunAt = now;
    saveState(st);
    return { error: err.message };
  }
}

// ─── CLI Entry Point ────────────────────────────────────────────────────────

if (require.main === module) {
  runCycle()
    .then(r => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r?.error ? 1 : 0);
    })
    .catch(err => {
      console.error('Fatal:', err);
      process.exit(1);
    });
}

module.exports = { runCycle };
