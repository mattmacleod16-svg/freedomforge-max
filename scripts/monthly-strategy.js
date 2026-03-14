/*
 * Monthly strategy recommendation report
 *
 * Reviews operational/revenue logs + public market signals and outputs
 * adaptive, numeric parameter recommendations to improve reliability.
 */

const path = require('path');
const dotenv = require('dotenv');
const { createLogger } = require('../lib/logger');
const logger = createLogger('monthly-strategy');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const APP_BASE_URL = (process.env.APP_BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'https://freedomforge-max.up.railway.app').replace(/\/$/, '');
const ALERT_URL = process.env.ALERT_WEBHOOK_URL || '';
const ALERT_MENTION = (process.env.ALERT_MENTION || '').trim();
const LOOKBACK_HOURS = Math.max(24, parseInt(process.env.STRATEGY_LOOKBACK_HOURS || '720', 10));
const LOG_LIMIT = Math.max(100, parseInt(process.env.STRATEGY_LOG_LIMIT || '4000', 10));
const SOURCE = process.env.STRATEGY_SOURCE || 'monthly-strategy';
const MARKET_DATA_ENABLED = String(process.env.STRATEGY_MARKET_DATA_ENABLED || 'true').toLowerCase() === 'true';
const SHORT_WINDOW_HOURS = Math.max(24, parseInt(process.env.STRATEGY_SHORT_WINDOW_HOURS || '168', 10));

const LOGS_URL = `${APP_BASE_URL}/api/alchemy/wallet/logs?limit=${LOG_LIMIT}`;
const WALLET_URL = `${APP_BASE_URL}/api/alchemy/wallet`;

function isDiscordWebhook(url) {
  return /discord(?:app)?\.com\/api\/webhooks\//i.test(url);
}

function withMention(message) {
  if (!ALERT_MENTION || !isDiscordWebhook(ALERT_URL)) return message;
  return `${ALERT_MENTION} ${message}`;
}

function parseBigIntSafe(value) {
  try {
    if (value === undefined || value === null || value === '') return BigInt(0);
    return BigInt(String(value));
  } catch {
    return BigInt(0);
  }
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatWeiAsEth(wei) {
  const abs = wei < 0 ? -wei : wei;
  const base = BigInt('1000000000000000000');
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '');
  const text = fracStr ? `${whole}.${fracStr}` : `${whole}`;
  return wei < 0 ? `-${text}` : text;
}

function formatPct(value) {
  return value === null ? 'n/a' : `${value.toFixed(2)}%`;
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

async function sendAlert(message) {
  if (!ALERT_URL) {
    console.log(message);
    return;
  }
  const finalMessage = withMention(message);
  const body = JSON.stringify({ content: finalMessage, text: finalMessage });
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

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`request failed (${response.status}) for ${url}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonSafe(url) {
  try {
    return await fetchJson(url);
  } catch {
    return null;
  }
}

async function fetchMarketSignals() {
  if (!MARKET_DATA_ENABLED) {
    return {
      enabled: false,
      fearGreed: null,
      btcUsd: null,
      ethUsd: null,
      btc24h: null,
      eth24h: null,
      btcDominance: null,
      marketCap24hChange: null,
      confidence: 'off',
    };
  }

  const [fng, cgPrices, binanceBtc, binanceEth, global] = await Promise.all([
    fetchJsonSafe('https://api.alternative.me/fng/?limit=1&format=json'),
    fetchJsonSafe('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true'),
    fetchJsonSafe('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT'),
    fetchJsonSafe('https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT'),
    fetchJsonSafe('https://api.coingecko.com/api/v3/global'),
  ]);

  const fearGreed = safeNumber(fng?.data?.[0]?.value);

  const btcUsd = safeNumber(cgPrices?.bitcoin?.usd) ?? safeNumber(binanceBtc?.lastPrice);
  const ethUsd = safeNumber(cgPrices?.ethereum?.usd) ?? safeNumber(binanceEth?.lastPrice);
  const btc24h = safeNumber(cgPrices?.bitcoin?.usd_24h_change) ?? safeNumber(binanceBtc?.priceChangePercent);
  const eth24h = safeNumber(cgPrices?.ethereum?.usd_24h_change) ?? safeNumber(binanceEth?.priceChangePercent);
  const btcDominance = safeNumber(global?.data?.market_cap_percentage?.btc);
  const marketCap24hChange = safeNumber(global?.data?.market_cap_change_percentage_24h_usd);

  const signalCount = [fearGreed, btcUsd, ethUsd, btc24h, eth24h, btcDominance, marketCap24hChange]
    .filter((v) => v !== null).length;
  const confidence = signalCount >= 6 ? 'high' : signalCount >= 4 ? 'medium' : 'low';

  return {
    enabled: true,
    fearGreed,
    btcUsd,
    ethUsd,
    btc24h,
    eth24h,
    btcDominance,
    marketCap24hChange,
    confidence,
  };
}

function summarize(logs) {
  const now = Date.now();
  const since = now - LOOKBACK_HOURS * 60 * 60 * 1000;
  const filtered = logs.filter((entry) => {
    const ts = Date.parse(entry?.time || '');
    return Number.isFinite(ts) && ts >= since;
  });

  const counts = {
    distributionStart: 0,
    distributionStartToken: 0,
    transferSuccess: 0,
    transferFail: 0,
    transferTokenSuccess: 0,
    transferTokenFail: 0,
    gasTopup: 0,
    gasTopupError: 0,
    gasCheckError: 0,
    tokenBalanceError: 0,
    skippedNativeThreshold: 0,
    skippedTokenThreshold: 0,
  };

  let nativeSentWei = BigInt(0);
  let tokenSentWei = BigInt(0);
  const nativeTransferEth = [];
  const gasTopupEth = [];

  for (const row of filtered) {
    const type = row?.type;
    const payload = row?.payload || {};
    if (type === 'distribution_start') counts.distributionStart += 1;
    if (type === 'distribution_start_token') counts.distributionStartToken += 1;
    if (type === 'transfer') {
      counts.transferSuccess += 1;
      const amt = parseBigIntSafe(payload.amount);
      nativeSentWei += amt;
      nativeTransferEth.push(Number(amt) / 1e18);
    }
    if (type === 'transfer_failed') counts.transferFail += 1;
    if (type === 'transfer_token') {
      counts.transferTokenSuccess += 1;
      tokenSentWei += parseBigIntSafe(payload.amount);
    }
    if (type === 'transfer_token_failed') counts.transferTokenFail += 1;
    if (type === 'gas_topup') {
      counts.gasTopup += 1;
      const amount = safeNumber(payload.amount);
      if (amount !== null) gasTopupEth.push(amount);
    }
    if (type === 'gas_topup_error') counts.gasTopupError += 1;
    if (type === 'gas_check_error') counts.gasCheckError += 1;
    if (type === 'token_balance_error') counts.tokenBalanceError += 1;
    if (type === 'distribution_skipped_threshold') counts.skippedNativeThreshold += 1;
    if (type === 'distribution_skipped_token_threshold') counts.skippedTokenThreshold += 1;
  }

  return { filtered, counts, nativeSentWei, tokenSentWei, nativeTransferEth, gasTopupEth };
}

function windowStats(logsWindow) {
  let transferSuccess = 0;
  let transferFailed = 0;
  let gasErrors = 0;
  let thresholdSkips = 0;

  for (const row of logsWindow) {
    const type = row?.type;
    if (type === 'transfer' || type === 'transfer_token') transferSuccess += 1;
    if (type === 'transfer_failed' || type === 'transfer_token_failed') transferFailed += 1;
    if (type === 'gas_topup_error' || type === 'gas_check_error') gasErrors += 1;
    if (type === 'distribution_skipped_threshold' || type === 'distribution_skipped_token_threshold') thresholdSkips += 1;
  }

  const attempts = transferSuccess + transferFailed;
  const failRate = attempts > 0 ? transferFailed / attempts : 0;

  return {
    attempts,
    failRate,
    gasErrors,
    thresholdSkips,
  };
}

function trendAnalysis(filtered) {
  if (!Array.isArray(filtered) || filtered.length < 12) {
    return {
      hasTrend: false,
      message: 'Insufficient recent samples for trend analysis.',
    };
  }

  const cutoff = Date.now() - SHORT_WINDOW_HOURS * 60 * 60 * 1000;
  const newerWindow = filtered.filter((entry) => Date.parse(entry?.time || '') >= cutoff);
  const olderWindow = filtered.filter((entry) => Date.parse(entry?.time || '') < cutoff);

  if (olderWindow.length < 6 || newerWindow.length < 6) {
    return {
      hasTrend: false,
      message: 'Insufficient split-window samples for trend analysis.',
    };
  }

  const older = windowStats(olderWindow);
  const newer = windowStats(newerWindow);

  return {
    hasTrend: true,
    older,
    newer,
    failDelta: newer.failRate - older.failRate,
    gasDelta: newer.gasErrors - older.gasErrors,
    skipDelta: newer.thresholdSkips - older.thresholdSkips,
  };
}

function regimeScore(market) {
  if (!market?.enabled) return { score: 50, regime: 'neutral', explanation: 'market data disabled' };

  let score = 50;
  const reasons = [];

  if (market.fearGreed !== null) {
    if (market.fearGreed <= 15) { score -= 25; reasons.push('extreme fear'); }
    else if (market.fearGreed <= 25) { score -= 15; reasons.push('high fear'); }
    else if (market.fearGreed >= 70) { score += 10; reasons.push('risk appetite elevated'); }
  }

  if (market.eth24h !== null) {
    if (market.eth24h <= -6) { score -= 15; reasons.push('ETH selloff'); }
    else if (market.eth24h >= 6) { score += 8; reasons.push('ETH momentum positive'); }
  }

  if (market.marketCap24hChange !== null) {
    if (market.marketCap24hChange <= -3) { score -= 10; reasons.push('total market cap down'); }
    else if (market.marketCap24hChange >= 3) { score += 6; reasons.push('total market cap up'); }
  }

  if (market.btcDominance !== null && market.btcDominance >= 58) {
    score -= 8;
    reasons.push('BTC dominance high');
  }

  score = Math.round(clamp(score, 0, 100));
  const regime = score < 40 ? 'risk-off' : score > 65 ? 'risk-on' : 'neutral';

  return {
    score,
    regime,
    explanation: reasons.length > 0 ? reasons.join(', ') : 'balanced signals',
  };
}

function adaptiveTargets(summary, marketRegime, trend) {
  const c = summary.counts;
  const p25Transfer = percentile(summary.nativeTransferEth, 25);
  const medTransfer = median(summary.nativeTransferEth);
  const medTopup = median(summary.gasTopupEth);

  let minPayoutEth = p25Transfer !== null ? clamp(p25Transfer * 0.55, 0.0005, 0.02) : 0.001;
  let gasReserveEth = marketRegime.regime === 'risk-off' ? 0.007 : 0.005;
  let topupAmountEth = medTopup !== null ? clamp(medTopup, 0.008, 0.05) : 0.01;

  if (trend?.hasTrend) {
    if (trend.failDelta > 0.03 || trend.gasDelta > 0) {
      gasReserveEth += 0.0015;
      topupAmountEth += 0.002;
    }
    if (trend.skipDelta > 2) {
      minPayoutEth = Math.max(0.0005, minPayoutEth * 0.8);
    }
  }

  if ((c.skippedNativeThreshold + c.skippedTokenThreshold) > 8) {
    minPayoutEth = Math.max(0.0005, minPayoutEth * 0.75);
  }

  if (marketRegime.regime === 'risk-on' && medTransfer !== null && medTransfer > 0) {
    minPayoutEth = clamp(minPayoutEth * 1.15, 0.0005, 0.03);
  }

  topupAmountEth = clamp(Math.max(topupAmountEth, gasReserveEth * 1.6), 0.008, 0.08);
  const topupThresholdEth = clamp(Math.max(gasReserveEth * 0.9, minPayoutEth * 1.2), 0.005, 0.05);
  const fundingAlertEth = clamp(Math.max(topupAmountEth * 3, 0.03), 0.03, 0.3);

  return {
    MIN_PAYOUT_ETH: minPayoutEth.toFixed(4),
    GAS_RESERVE_ETH: gasReserveEth.toFixed(4),
    GAS_TOPUP_AMOUNT: topupAmountEth.toFixed(4),
    GAS_TOPUP_THRESHOLD: topupThresholdEth.toFixed(4),
    FUNDING_LOW_BALANCE_ALERT_ETH: fundingAlertEth.toFixed(4),
  };
}

function recommendations(summary, market, trend, marketRegime, targets) {
  const recs = [];
  const c = summary.counts;

  const nativeAttempts = c.transferSuccess + c.transferFail;
  const tokenAttempts = c.transferTokenSuccess + c.transferTokenFail;
  const nativeFailRate = nativeAttempts > 0 ? c.transferFail / nativeAttempts : 0;
  const tokenFailRate = tokenAttempts > 0 ? c.transferTokenFail / tokenAttempts : 0;

  if (c.distributionStart + c.distributionStartToken === 0) {
    recs.push('No distributions detected in lookback. Ensure scheduler cadence and payout thresholds align with inbound revenue.');
  }

  if (c.skippedNativeThreshold >= 5 || c.skippedTokenThreshold >= 5) {
    recs.push('Threshold skips are frequent. Lower payout threshold to improve throughput.');
  }

  if (nativeFailRate >= 0.1 || tokenFailRate >= 0.1) {
    recs.push('Transfer reliability is weak. Increase retries/backoff and reduce payout pressure until fail rate stabilizes.');
  }

  if (c.gasTopupError + c.gasCheckError > 0) {
    recs.push('Gas/topup errors occurred. Increase treasury buffer and confirm funding wallet can cover topups plus fee reserve.');
  }

  if (c.tokenBalanceError > 0) {
    recs.push('Token balance errors detected. Validate token contract, network alignment, and RPC health.');
  }

  if (market?.enabled && marketRegime.regime === 'risk-off') {
    recs.push('Market regime is risk-off. Favor reliability and reserve preservation over aggressive payout frequency.');
  }

  if (trend?.hasTrend && trend.failDelta > 0.05) {
    recs.push('Execution fail rate is deteriorating in the recent window. Tighten safety params and monitor run-by-run outcomes.');
  }

  if (recs.length === 0) {
    recs.push('Execution and market posture are stable. Maintain current settings and scale throughput incrementally.');
  }

  recs.push(
    `Suggested env targets: MIN_PAYOUT_ETH=${targets.MIN_PAYOUT_ETH}, GAS_RESERVE_ETH=${targets.GAS_RESERVE_ETH}, GAS_TOPUP_AMOUNT=${targets.GAS_TOPUP_AMOUNT}, GAS_TOPUP_THRESHOLD=${targets.GAS_TOPUP_THRESHOLD}, FUNDING_LOW_BALANCE_ALERT_ETH=${targets.FUNDING_LOW_BALANCE_ALERT_ETH}`
  );

  return {
    nativeAttempts,
    tokenAttempts,
    nativeFailRate: Math.round(nativeFailRate * 100),
    tokenFailRate: Math.round(tokenFailRate * 100),
    recs,
  };
}

function buildMessage(summary, analysis, wallet, market, trend, regime, targets) {
  const c = summary.counts;
  const walletAddress = wallet?.address || 'unknown';
  const walletBalance = parseBigIntSafe(wallet?.balance || '0');

  const lines = [
    `🧠 Monthly Strategy Report (${SOURCE})`,
    `Window: last ${LOOKBACK_HOURS}h`,
    `Wallet: ${walletAddress}`,
    `Current balance: ${formatWeiAsEth(walletBalance)} ETH`,
    `Native volume sent: ${formatWeiAsEth(summary.nativeSentWei)} ETH | attempts ${analysis.nativeAttempts} | fail rate ${analysis.nativeFailRate}%`,
    `Token volume sent (raw wei): ${summary.tokenSentWei.toString()} | attempts ${analysis.tokenAttempts} | fail rate ${analysis.tokenFailRate}%`,
    `Distribution runs: native ${c.distributionStart}, token ${c.distributionStartToken}`,
    `Threshold skips: native ${c.skippedNativeThreshold}, token ${c.skippedTokenThreshold}`,
    `Gas/topup issues: ${c.gasTopupError + c.gasCheckError} | Token balance errors: ${c.tokenBalanceError}`,
    market?.enabled
      ? `Market: confidence ${market.confidence} | Fear&Greed ${market.fearGreed ?? 'n/a'} | BTC ${market.btcUsd ?? 'n/a'} | ETH ${market.ethUsd ?? 'n/a'} | ETH 24h ${formatPct(market.eth24h)} | BTC dom ${formatPct(market.btcDominance)} | MCap 24h ${formatPct(market.marketCap24hChange)}`
      : 'Market: disabled',
    `Regime score: ${regime.score}/100 (${regime.regime}) — ${regime.explanation}`,
    trend?.hasTrend
      ? `Trend (${SHORT_WINDOW_HOURS}h vs prior): fail-rate delta ${(trend.failDelta * 100).toFixed(2)}pp | gas delta ${trend.gasDelta} | skip delta ${trend.skipDelta}`
      : `Trend: ${trend?.message || 'n/a'}`,
    `Adaptive targets: MIN_PAYOUT_ETH=${targets.MIN_PAYOUT_ETH}, GAS_RESERVE_ETH=${targets.GAS_RESERVE_ETH}, GAS_TOPUP_AMOUNT=${targets.GAS_TOPUP_AMOUNT}, GAS_TOPUP_THRESHOLD=${targets.GAS_TOPUP_THRESHOLD}, FUNDING_LOW_BALANCE_ALERT_ETH=${targets.FUNDING_LOW_BALANCE_ALERT_ETH}`,
    'Recommended actions:',
    ...analysis.recs.map((r, i) => `${i + 1}) ${r}`),
  ];

  return lines.join('\n');
}

async function main() {
  const [logsPayload, walletPayload, market] = await Promise.all([
    fetchJson(LOGS_URL),
    fetchJson(WALLET_URL),
    fetchMarketSignals(),
  ]);

  const logs = Array.isArray(logsPayload?.logs) ? logsPayload.logs : [];
  const summary = summarize(logs);
  const trend = trendAnalysis(summary.filtered);
  const regime = regimeScore(market);
  const targets = adaptiveTargets(summary, regime, trend);
  const analysis = recommendations(summary, market, trend, regime, targets);
  const message = buildMessage(summary, analysis, walletPayload || {}, market, trend, regime, targets);

  await sendAlert(message);
  console.log('monthly-strategy: sent');
}

main().catch(async (error) => {
  const message = error?.message || String(error);
  console.error('monthly-strategy failed:', message);
  try {
    await sendAlert(`❌ Monthly strategy report failed: ${message}`);
  } catch (alertErr) { logger.warn('failed to send failure alert', { error: alertErr?.message || alertErr }); }
  process.exit(1);
});
