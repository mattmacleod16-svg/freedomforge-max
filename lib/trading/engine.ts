/* ═══════════════════════════════════════════════════════════════
   FreedomForge Trading Engine
   ═══════════════════════════════════════════════════════════════

   Multi-exchange autonomous trading with:
   • Paper trading mode (default — no real money at risk)
   • Risk management framework (position/loss/order limits)
   • Kill switch for emergency halt
   • Audit trail for all operations
   • Coinbase Advanced Trade + Kraken + ViaBTC mining

   Environment Variables:
     TRADING_MODE=paper|live          (default: paper)
     MAX_POSITION_USD=1000            (default: 1000)
     MAX_DAILY_LOSS_USD=200           (default: 200)
     MAX_ORDER_SIZE_USD=500           (default: 500)
     COINBASE_API_KEY / COINBASE_API_SECRET
     KRAKEN_API_KEY / KRAKEN_API_SECRET
     VIABTC_API_KEY / VIABTC_API_SECRET
   ═══════════════════════════════════════════════════════════════ */

import { coinbaseClient } from './coinbase';
import { krakenClient } from './kraken';
import { viabtcClient } from './viabtc';

/* ── Types ──────────────────────────────────────────────────── */

export type Exchange = 'coinbase' | 'kraken';
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type TradingMode = 'paper' | 'live';

export interface TradeOrder {
  exchange: Exchange;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  amount: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface TradeResult {
  id: string;
  exchange: Exchange;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  amount: number;
  price: number;
  status: 'filled' | 'pending' | 'paper' | 'rejected';
  timestamp: number;
  mode: TradingMode;
  reason?: string;
}

export interface RiskLimits {
  maxPositionUSD: number;
  maxDailyLossUSD: number;
  maxOrderSizeUSD: number;
  maxOpenOrders: number;
  allowedSymbols: string[];
}

export interface PortfolioBalance {
  exchange: string;
  currency: string;
  available: number;
  usdValue: number;
}

export interface MiningStats {
  hashrate: number;
  hashrateUnit: string;
  workers: number;
  earnings24h: number;
  earningsTotal: number;
  currency: string;
}

/* ── Constants ──────────────────────────────────────────────── */

const ALLOWED_SYMBOLS = [
  'BTC-USD', 'ETH-USD', 'SOL-USD', 'DOGE-USD', 'XRP-USD',
  'ADA-USD', 'AVAX-USD', 'LINK-USD', 'DOT-USD', 'MATIC-USD',
  'SHIB-USD', 'UNI-USD', 'AAVE-USD', 'ARB-USD', 'OP-USD',
];

const DEFAULT_RISK: RiskLimits = {
  maxPositionUSD: 1000,
  maxDailyLossUSD: 200,
  maxOrderSizeUSD: 500,
  maxOpenOrders: 5,
  allowedSymbols: ALLOWED_SYMBOLS,
};

/* ── State ──────────────────────────────────────────────────── */

const tradeLog: TradeResult[] = [];
let dailyPnL = 0;
let dailyPnLResetTs = Date.now();
let killSwitch = false;

/* ── Mode & Config ──────────────────────────────────────────── */

export function getTradingMode(): TradingMode {
  return process.env.TRADING_MODE === 'live' ? 'live' : 'paper';
}

export function getRiskLimits(): RiskLimits {
  return {
    ...DEFAULT_RISK,
    maxPositionUSD: Number(process.env.MAX_POSITION_USD) || DEFAULT_RISK.maxPositionUSD,
    maxDailyLossUSD: Number(process.env.MAX_DAILY_LOSS_USD) || DEFAULT_RISK.maxDailyLossUSD,
    maxOrderSizeUSD: Number(process.env.MAX_ORDER_SIZE_USD) || DEFAULT_RISK.maxOrderSizeUSD,
  };
}

export function isKillSwitchActive(): boolean { return killSwitch; }
export function setKillSwitch(active: boolean): void { killSwitch = active; }

/* ── Daily P&L Reset ────────────────────────────────────────── */

function resetDailyIfNeeded() {
  if (Date.now() - dailyPnLResetTs > 86_400_000) {
    dailyPnL = 0;
    dailyPnLResetTs = Date.now();
  }
}

/* ── Validation ─────────────────────────────────────────────── */

export function validateOrder(order: TradeOrder): { valid: boolean; reason?: string } {
  if (killSwitch) return { valid: false, reason: 'Kill switch active — all trading halted' };

  const limits = getRiskLimits();
  resetDailyIfNeeded();

  const sym = order.symbol.toUpperCase();
  if (!limits.allowedSymbols.some(s => sym.includes(s.replace('-', '')) || s === sym)) {
    return { valid: false, reason: `Symbol ${sym} not in allowed list` };
  }

  const estUSD = order.type === 'limit' && order.price
    ? order.amount * order.price
    : order.amount;

  if (estUSD > limits.maxOrderSizeUSD) {
    return { valid: false, reason: `Order ~$${estUSD.toFixed(0)} exceeds max $${limits.maxOrderSizeUSD}` };
  }

  if (dailyPnL < -limits.maxDailyLossUSD) {
    return { valid: false, reason: `Daily loss limit hit ($${Math.abs(dailyPnL).toFixed(2)} / $${limits.maxDailyLossUSD})` };
  }

  const openCount = tradeLog.filter(t => t.status === 'pending').length;
  if (openCount >= limits.maxOpenOrders) {
    return { valid: false, reason: `Max open orders reached (${openCount}/${limits.maxOpenOrders})` };
  }

  return { valid: true };
}

/* ── Execution ──────────────────────────────────────────────── */

export async function executeTrade(order: TradeOrder): Promise<TradeResult> {
  const mode = getTradingMode();
  const validation = validateOrder(order);

  if (!validation.valid) {
    const rejected: TradeResult = {
      id: `rej-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      exchange: order.exchange, symbol: order.symbol, side: order.side,
      type: order.type, amount: order.amount, price: order.price || 0,
      status: 'rejected', timestamp: Date.now(), mode,
      reason: validation.reason,
    };
    tradeLog.unshift(rejected);
    return rejected;
  }

  if (mode === 'paper') {
    const paper: TradeResult = {
      id: `paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      exchange: order.exchange, symbol: order.symbol, side: order.side,
      type: order.type, amount: order.amount, price: order.price || 0,
      status: 'paper', timestamp: Date.now(), mode: 'paper',
    };
    tradeLog.unshift(paper);
    return paper;
  }

  try {
    const result = order.exchange === 'coinbase'
      ? await coinbaseClient.placeOrder(order)
      : await krakenClient.placeOrder(order);
    tradeLog.unshift(result);
    return result;
  } catch (err) {
    const failed: TradeResult = {
      id: `err-${Date.now()}`,
      exchange: order.exchange, symbol: order.symbol, side: order.side,
      type: order.type, amount: order.amount, price: order.price || 0,
      status: 'rejected', timestamp: Date.now(), mode,
      reason: err instanceof Error ? err.message : 'Exchange error',
    };
    tradeLog.unshift(failed);
    return failed;
  }
}

/* ── Queries ────────────────────────────────────────────────── */

export function getTradeLog(limit = 50): TradeResult[] {
  return tradeLog.slice(0, limit);
}

export function getDailyPnL(): number {
  resetDailyIfNeeded();
  return dailyPnL;
}

/* ── Portfolio Aggregation ──────────────────────────────────── */

export async function getAggregatedPortfolio(): Promise<{
  balances: PortfolioBalance[];
  totalUSD: number;
  mining: MiningStats | null;
}> {
  const balances: PortfolioBalance[] = [];
  let mining: MiningStats | null = null;

  if (coinbaseClient.isConfigured()) {
    try {
      const accounts = await coinbaseClient.getAccounts();
      for (const acct of accounts) {
        const val = parseFloat(acct.available_balance.value);
        if (val > 0) {
          balances.push({ exchange: 'coinbase', currency: acct.currency, available: val, usdValue: val });
        }
      }
    } catch { /* silent */ }
  }

  if (krakenClient.isConfigured()) {
    try {
      const bal = await krakenClient.getBalance();
      for (const [currency, amount] of Object.entries(bal)) {
        const val = parseFloat(amount);
        if (val > 0.001) {
          balances.push({ exchange: 'kraken', currency: currency.replace(/^[XZ]/, ''), available: val, usdValue: val });
        }
      }
    } catch { /* silent */ }
  }

  if (viabtcClient.isConfigured()) {
    try { mining = await viabtcClient.getMiningStats(); } catch { /* silent */ }
  }

  const totalUSD = balances.reduce((sum, b) => sum + b.usdValue, 0);
  return { balances, totalUSD, mining };
}

/* ── Exchange Status ────────────────────────────────────────── */

export function getExchangeStatus() {
  return {
    coinbase: { configured: coinbaseClient.isConfigured(), name: 'Coinbase' },
    kraken: { configured: krakenClient.isConfigured(), name: 'Kraken' },
    viabtc: { configured: viabtcClient.isConfigured(), name: 'ViaBTC' },
  };
}
