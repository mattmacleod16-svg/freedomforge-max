/**
 * Fill Verifier — Post-Order Verification
 * =========================================
 *
 * After an order is placed, this module polls the exchange API to verify
 * the order actually filled, capture the real fill price and size, and
 * compute slippage vs the expected price.
 *
 * Supported exchanges:
 *   - Coinbase Advanced Trade (CDP mode: /api/v3/brokerage/orders/{id})
 *   - Coinbase Exchange (Legacy: /orders/{id})
 *   - Kraken (/0/private/QueryOrders)
 *
 * Returns a standardized FillResult:
 *   {
 *     verified: boolean,
 *     status: 'filled' | 'partial' | 'cancelled' | 'pending' | 'unknown',
 *     fillPrice: number,
 *     fillSize: number,
 *     fillUsd: number,
 *     requestedUsd: number,
 *     slippagePct: number,
 *     orderId: string,
 *     rawResponse: object,
 *   }
 *
 * Usage:
 *   const fv = require('../lib/fill-verifier');
 *   const fill = await fv.verifyFill({ venue: 'coinbase', orderId: '...', expectedPrice: 50000, side: 'buy', requestedUsd: 25 });
 */

const crypto = require('crypto');
const { createLogger } = require('./logger');
const log = createLogger('fill-verifier');

// ─── Configuration ──────────────────────────────────────────────────────────

const VERIFY_MAX_ATTEMPTS = Math.min(20, Math.max(1, Number(process.env.FILL_VERIFY_MAX_ATTEMPTS || 5)));
const VERIFY_POLL_MS = Math.min(30000, Math.max(500, Number(process.env.FILL_VERIFY_POLL_MS || 2000)));
const REQUEST_TIMEOUT_MS = Math.min(60000, Math.max(3000, Number(process.env.FILL_VERIFY_TIMEOUT_MS || 10000)));

// Coinbase
const CB_API_KEY = process.env.COINBASE_API_KEY || '';
const CB_API_SECRET = process.env.COINBASE_API_SECRET || '';
const CB_API_PASSPHRASE = process.env.COINBASE_API_PASSPHRASE || '';
const CB_BASE = process.env.COINBASE_API_URL || 'https://api.exchange.coinbase.com';
const CDP_BASE = 'https://api.coinbase.com';
const COINBASE_CDP_MODE = String(process.env.COINBASE_CDP_MODE || 'true').toLowerCase() === 'true';

// Kraken
const KR_API_KEY = process.env.KRAKEN_API_KEY || '';
const KR_API_SECRET = process.env.KRAKEN_API_SECRET || '';
const KR_BASE = 'https://api.kraken.com';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { _raw: text, _status: res.status }; }
  } finally { clearTimeout(timer); }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function defaultResult(orderId, requestedUsd) {
  return {
    verified: false,
    status: 'unknown',
    fillPrice: 0,
    fillSize: 0,
    fillUsd: 0,
    requestedUsd,
    slippagePct: 0,
    orderId,
    rawResponse: null,
    attempts: 0,
  };
}

// ─── Coinbase CDP Signing ───────────────────────────────────────────────────

function toBase64Url(data) {
  const b = typeof data === 'string' ? Buffer.from(data) : data;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createCdpJwt(method, requestPath) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: CB_API_KEY, nonce: crypto.randomBytes(16).toString('hex'), typ: 'JWT' };
  const payload = {
    sub: CB_API_KEY,
    iss: 'cdp',
    nbf: now,
    exp: now + 120,
    uri: `${String(method || 'GET').toUpperCase()} api.coinbase.com${requestPath}`,
  };
  const headerPart = toBase64Url(JSON.stringify(header));
  const payloadPart = toBase64Url(JSON.stringify(payload));
  const signingInput = `${headerPart}.${payloadPart}`;

  const privateKeyPem = CB_API_SECRET.includes('\\n') ? CB_API_SECRET.replace(/\\n/g, '\n') : CB_API_SECRET;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), { key: privateKeyPem, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${toBase64Url(signature)}`;
}

// ─── Coinbase Legacy Signing ────────────────────────────────────────────────

function signCoinbaseLegacy(timestamp, method, requestPath, body) {
  const message = timestamp + method + requestPath + body;
  const hmac = crypto.createHmac('sha256', Buffer.from(CB_API_SECRET, 'base64'));
  hmac.update(message);
  return hmac.digest('base64');
}

// ─── Kraken Signing ─────────────────────────────────────────────────────────

function signKraken(apiPath, body) {
  const nonce = body.get('nonce');
  const sha256 = crypto.createHash('sha256').update(nonce + body.toString()).digest();
  const hmac = crypto.createHmac('sha512', Buffer.from(KR_API_SECRET, 'base64'));
  hmac.update(Buffer.concat([Buffer.from(apiPath), sha256]));
  return hmac.digest('base64');
}

// ─── Coinbase Order Status ──────────────────────────────────────────────────

async function getCoinbaseCdpOrder(orderId) {
  const requestPath = `/api/v3/brokerage/orders/historical/${orderId}`;
  const token = createCdpJwt('GET', requestPath);
  return fetchWithTimeout(`${CDP_BASE}${requestPath}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
}

async function getCoinbaseLegacyOrder(orderId) {
  const requestPath = `/orders/${orderId}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signCoinbaseLegacy(timestamp, 'GET', requestPath, '');
  return fetchWithTimeout(`${CB_BASE}${requestPath}`, {
    headers: {
      Accept: 'application/json',
      'CB-ACCESS-KEY': CB_API_KEY,
      'CB-ACCESS-SIGN': signature,
      'CB-ACCESS-TIMESTAMP': timestamp,
      'CB-ACCESS-PASSPHRASE': CB_API_PASSPHRASE,
    },
  });
}

async function verifyCoinbaseFill(orderId, expectedPrice, side, requestedUsd) {
  const result = defaultResult(orderId, requestedUsd);

  if (!orderId) { result.status = 'no_order_id'; return result; }
  const hasCreds = COINBASE_CDP_MODE ? (CB_API_KEY && CB_API_SECRET) : (CB_API_KEY && CB_API_SECRET && CB_API_PASSPHRASE);
  if (!hasCreds) { result.status = 'missing_credentials'; return result; }

  for (let attempt = 1; attempt <= VERIFY_MAX_ATTEMPTS; attempt++) {
    result.attempts = attempt;
    try {
      const data = COINBASE_CDP_MODE
        ? await getCoinbaseCdpOrder(orderId)
        : await getCoinbaseLegacyOrder(orderId);

      result.rawResponse = data;

      // CDP mode response
      if (COINBASE_CDP_MODE) {
        const order = data?.order || data;
        const status = String(order?.status || '').toUpperCase();

        if (status === 'FILLED') {
          const filledSize = Number(order?.filled_size || 0);
          const filledValue = Number(order?.filled_value || order?.total_value_after_fees || 0);
          const avgPrice = filledSize > 0 ? filledValue / filledSize : 0;

          result.verified = true;
          result.status = 'filled';
          result.fillPrice = avgPrice;
          result.fillSize = filledSize;
          result.fillUsd = filledValue;
          if (expectedPrice > 0 && avgPrice > 0) {
            const rawSlip = side === 'buy'
              ? (avgPrice - expectedPrice) / expectedPrice
              : (expectedPrice - avgPrice) / expectedPrice;
            result.slippagePct = Math.round(rawSlip * 10000) / 100;
          }
          return result;
        }

        if (status === 'CANCELLED' || status === 'EXPIRED' || status === 'FAILED') {
          result.status = status.toLowerCase();
          result.verified = true;
          return result;
        }

        // PENDING or OPEN — wait and retry
        if (attempt < VERIFY_MAX_ATTEMPTS) { await sleep(VERIFY_POLL_MS); continue; }
        result.status = 'pending';
        return result;
      }

      // Legacy mode response
      const legacyStatus = String(data?.status || '').toLowerCase();
      if (legacyStatus === 'done' || legacyStatus === 'settled') {
        const filledSize = Number(data?.filled_size || 0);
        const executedValue = Number(data?.executed_value || 0);
        const avgPrice = filledSize > 0 ? executedValue / filledSize : 0;
        const fees = Number(data?.fill_fees || 0);

        result.verified = true;
        result.status = 'filled';
        result.fillPrice = avgPrice;
        result.fillSize = filledSize;
        result.fillUsd = executedValue + fees;
        if (expectedPrice > 0 && avgPrice > 0) {
          const rawSlip = side === 'buy'
            ? (avgPrice - expectedPrice) / expectedPrice
            : (expectedPrice - avgPrice) / expectedPrice;
          result.slippagePct = Math.round(rawSlip * 10000) / 100;
        }
        return result;
      }

      if (legacyStatus === 'rejected' || legacyStatus === 'cancelled') {
        result.status = legacyStatus;
        result.verified = true;
        return result;
      }

      if (attempt < VERIFY_MAX_ATTEMPTS) { await sleep(VERIFY_POLL_MS); continue; }
      result.status = 'pending';
      return result;

    } catch (err) {
      if (attempt === VERIFY_MAX_ATTEMPTS) {
        result.status = 'verify_error';
        result.error = err?.message || String(err);
      } else {
        await sleep(VERIFY_POLL_MS);
      }
    }
  }

  return result;
}

// ─── Kraken Order Status ────────────────────────────────────────────────────

async function verifyKrakenFill(txid, expectedPrice, side, requestedUsd) {
  const result = defaultResult(txid, requestedUsd);

  if (!txid) { result.status = 'no_order_id'; return result; }
  if (!KR_API_KEY || !KR_API_SECRET) { result.status = 'missing_credentials'; return result; }

  // Handle txid — Kraken returns either a string or array
  const orderTxid = Array.isArray(txid) ? txid[0] : txid;

  for (let attempt = 1; attempt <= VERIFY_MAX_ATTEMPTS; attempt++) {
    result.attempts = attempt;
    try {
      const nonce = String(Date.now() * 1000);
      const apiPath = '/0/private/QueryOrders';
      const body = new URLSearchParams({ nonce, txid: orderTxid });

      const sha256 = crypto.createHash('sha256').update(nonce + body.toString()).digest();
      const hmac = crypto.createHmac('sha512', Buffer.from(KR_API_SECRET, 'base64'));
      hmac.update(Buffer.concat([Buffer.from(apiPath), sha256]));
      const signature = hmac.digest('base64');

      const data = await fetchWithTimeout(`${KR_BASE}${apiPath}`, {
        method: 'POST',
        headers: {
          'API-Key': KR_API_KEY,
          'API-Sign': signature,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      result.rawResponse = data;

      if (data?.error?.length > 0) {
        result.status = 'api_error';
        result.error = data.error.join(', ');
        if (attempt < VERIFY_MAX_ATTEMPTS) { await sleep(VERIFY_POLL_MS); continue; }
        return result;
      }

      const orderData = data?.result?.[orderTxid];
      if (!orderData) {
        if (attempt < VERIFY_MAX_ATTEMPTS) { await sleep(VERIFY_POLL_MS); continue; }
        result.status = 'not_found';
        return result;
      }

      const status = String(orderData.status || '').toLowerCase();

      if (status === 'closed') {
        const vol = Number(orderData.vol_exec || orderData.vol || 0);
        const cost = Number(orderData.cost || 0);
        const fee = Number(orderData.fee || 0);
        const avgPrice = vol > 0 ? cost / vol : 0;

        result.verified = true;
        result.status = 'filled';
        result.fillPrice = avgPrice;
        result.fillSize = vol;
        result.fillUsd = cost + fee;
        if (expectedPrice > 0 && avgPrice > 0) {
          const rawSlip = side === 'buy'
            ? (avgPrice - expectedPrice) / expectedPrice
            : (expectedPrice - avgPrice) / expectedPrice;
          result.slippagePct = Math.round(rawSlip * 10000) / 100;
        }
        return result;
      }

      if (status === 'canceled' || status === 'expired') {
        result.verified = true;
        result.status = status;
        return result;
      }

      // Open or pending — check for partial fill
      const volExec = Number(orderData.vol_exec || 0);
      const volTotal = Number(orderData.vol || 0);
      if (volExec > 0 && volExec < volTotal) {
        const cost = Number(orderData.cost || 0);
        const avgPrice = volExec > 0 ? cost / volExec : 0;
        result.status = 'partial';
        result.fillPrice = avgPrice;
        result.fillSize = volExec;
        result.fillUsd = cost;
        if (expectedPrice > 0 && avgPrice > 0) {
          const rawSlip = side === 'buy'
            ? (avgPrice - expectedPrice) / expectedPrice
            : (expectedPrice - avgPrice) / expectedPrice;
          result.slippagePct = Math.round(rawSlip * 10000) / 100;
        }
        // Partial fill — keep trying for full fill
        if (attempt < VERIFY_MAX_ATTEMPTS) { await sleep(VERIFY_POLL_MS); continue; }
        result.verified = true;
        return result;
      }

      // Still open, not filled — wait
      if (attempt < VERIFY_MAX_ATTEMPTS) { await sleep(VERIFY_POLL_MS); continue; }
      result.status = 'pending';
      return result;

    } catch (err) {
      if (attempt === VERIFY_MAX_ATTEMPTS) {
        result.status = 'verify_error';
        result.error = err?.message || String(err);
      } else {
        await sleep(VERIFY_POLL_MS);
      }
    }
  }

  return result;
}

// ─── Fill Validation ─────────────────────────────────────────────────────────

const PRICE_DEVIATION_LIMIT = 0.10; // 10% max deviation from expected price
const EXTREME_SLIPPAGE_PCT = 2;     // warn above 2%

function validateFillResult(result, expectedPrice) {
  if (!result.verified || result.status !== 'filled') return result;

  // Fill size must be positive
  if (result.fillSize <= 0) {
    log.warn('fill has non-positive size — marking unverified', {
      orderId: result.orderId, fillSize: result.fillSize,
    });
    result.verified = false;
    result.status = 'invalid_fill_size';
    return result;
  }

  // Fill price sanity check against expected price
  if (expectedPrice > 0 && result.fillPrice > 0) {
    const deviation = Math.abs(result.fillPrice - expectedPrice) / expectedPrice;
    if (deviation > PRICE_DEVIATION_LIMIT) {
      log.warn('fill price deviates >10% from expected — marking suspicious', {
        orderId: result.orderId,
        fillPrice: result.fillPrice,
        expectedPrice,
        deviationPct: Math.round(deviation * 10000) / 100,
      });
      result.suspicious = true;
      result.priceDeviationPct = Math.round(deviation * 10000) / 100;
    }

    if (Math.abs(result.slippagePct) > EXTREME_SLIPPAGE_PCT) {
      log.warn('extreme slippage detected (>2%)', {
        orderId: result.orderId,
        slippagePct: result.slippagePct,
        fillPrice: result.fillPrice,
        expectedPrice,
      });
    }
  }

  return result;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Update trade journal with verified fill data, matching by trade ID.
 * Replaces the fragile last-index pattern (updateLastTradeField) with
 * deterministic trade-ID-based matching.
 *
 * @param {object} journal - Trade journal module (must have updateTradeById)
 * @param {string} tradeId - Journal trade ID returned by recordTrade()
 * @param {object} fill - Fill result from verifyFill()
 * @param {number} requestedUsd - Original requested order size in USD
 * @returns {boolean} Whether the journal was updated
 */
function updateJournalWithFill(journal, tradeId, fill, requestedUsd) {
  if (!journal || !tradeId || !fill?.verified || fill.status !== 'filled') return false;
  if (typeof journal.updateTradeById !== 'function') {
    log.warn('journal missing updateTradeById — falling back skipped to avoid last-index bug');
    return false;
  }
  try {
    const trade = typeof journal.getTradeById === 'function' ? journal.getTradeById(tradeId) : null;
    const updates = {
      fillPrice: fill.fillPrice,
      entryPrice: fill.fillPrice,
      slippagePct: fill.slippagePct,
      slippageUsd: Math.round((fill.slippagePct || 0) * (requestedUsd || 0)) / 100,
      fillSize: fill.fillSize,
      fillUsd: fill.fillUsd,
    };
    // Preserve original expected price before overwriting with fill price
    if (trade && trade.expectedPrice === undefined && trade.entryPrice) {
      updates.expectedPrice = trade.entryPrice;
    }
    return journal.updateTradeById(tradeId, updates);
  } catch (err) {
    log.warn('journal fill update failed', { tradeId, error: err?.message });
    return false;
  }
}

/**
 * Verify that an order actually filled on the exchange.
 *
 * @param {object} opts
 * @param {string} opts.venue - 'coinbase' or 'kraken'
 * @param {string} opts.orderId - Exchange order ID or txid
 * @param {number} opts.expectedPrice - Price at signal time
 * @param {string} opts.side - 'buy' or 'sell'
 * @param {number} opts.requestedUsd - Requested order size in USD
 * @returns {Promise<FillResult>}
 */
async function verifyFill({ venue, orderId, expectedPrice = 0, side = 'buy', requestedUsd = 0 }) {
  if (!orderId) return defaultResult(null, requestedUsd);

  let result;
  switch (venue?.toLowerCase()) {
    case 'coinbase':
      result = await verifyCoinbaseFill(orderId, expectedPrice, side, requestedUsd);
      break;
    case 'kraken':
      result = await verifyKrakenFill(orderId, expectedPrice, side, requestedUsd);
      break;
    default:
      return { ...defaultResult(orderId, requestedUsd), status: 'unsupported_venue' };
  }
  return validateFillResult(result, expectedPrice);
}

/**
 * Extract order ID from venue engine stdout (parsed JSON output).
 * Each venue returns order IDs in different response shapes.
 */
function extractOrderId(venue, stdout) {
  try {
    const parsed = typeof stdout === 'string' ? JSON.parse(stdout) : stdout;
    const actions = parsed?.actions || [];

    for (const action of actions) {
      if (action.status !== 'placed') continue;
      const r = action.result || {};

      switch (venue?.toLowerCase()) {
        case 'coinbase':
          return r.order_id || r.success_response?.order_id || r.id || null;
        case 'kraken':
          // Kraken returns { txid: ['ORDER-ID'] }
          return Array.isArray(r.txid) ? r.txid[0] : (r.txid || null);
        default:
          return r.order_id || r.txid || r.id || null;
      }
    }
  } catch { /* parse failure */ }
  return null;
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  verifyFill,
  updateJournalWithFill,
  extractOrderId,
  VERIFY_MAX_ATTEMPTS,
  VERIFY_POLL_MS,
};
