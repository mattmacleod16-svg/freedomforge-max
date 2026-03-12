#!/usr/bin/env node

/**
 * DeFi Yield Optimization Engine
 * ═══════════════════════════════
 *
 * Deposits idle USDC capital into Aave V3 or Compound V3 on Base L2 to earn
 * yield on otherwise dormant funds. Respects the capital mandate at all times:
 *   - NEVER deposits more than MAX_DEPOSIT_PCT of total capital
 *   - No deposits in survival or capital_halt mode
 *   - Auto-withdraws if kill switch is active
 *   - Gas guard: aborts if estimated gas exceeds $2
 *
 * Requires: ALCHEMY_API_KEY, WALLET_PRIVATE_KEY
 * Uses ethers.js v6 + Alchemy RPC on Base mainnet.
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createLogger } = require('../lib/logger');
const log = createLogger('defi-yield');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

// ─── Environment Configuration ────────────────────────────────────────────────

const ENABLED = String(process.env.DEFI_YIELD_ENABLED || 'false').toLowerCase() === 'true';
const DRY_RUN = String(process.env.DEFI_YIELD_DRY_RUN || 'true').toLowerCase() !== 'false';
const MIN_IDLE_USD = Math.min(100000, Math.max(1, Number(process.env.DEFI_YIELD_MIN_IDLE_USD || 50)));
const MAX_DEPOSIT_PCT = Math.max(0.01, Math.min(0.50, Number(process.env.DEFI_YIELD_MAX_DEPOSIT_PCT || 0.30)));
const MIN_APY = Math.min(100, Math.max(0, Number(process.env.DEFI_YIELD_MIN_APY || 2.0)));
const PROTOCOL = String(process.env.DEFI_YIELD_PROTOCOL || 'aave').toLowerCase();
const NETWORK = String(process.env.DEFI_YIELD_NETWORK || 'base').toLowerCase();
const CHECK_INTERVAL_SEC = Math.min(86400, Math.max(60, Number(process.env.DEFI_YIELD_CHECK_INTERVAL_SEC || 3600)));
const WALLET_PRIVATE_KEY = (process.env.WALLET_PRIVATE_KEY || '').trim();
const ALCHEMY_API_KEY = (process.env.ALCHEMY_API_KEY || '').trim();
const STATE_FILE = process.env.DEFI_YIELD_STATE_FILE || 'data/defi-yield-state.json';
const GAS_MAX_USD = 2.0; // hard cap: never spend more than $2 on gas per tx
const USDC_DECIMALS = 6;

// ─── Optional Library Imports (graceful fallback) ─────────────────────────────

let capitalMandate;
try { capitalMandate = require('../lib/capital-mandate'); } catch { capitalMandate = null; }

let riskManager;
try { riskManager = require('../lib/risk-manager'); } catch { riskManager = null; }

let rio;
try { rio = require('../lib/resilient-io'); } catch { rio = null; }

let signalBus;
try { signalBus = require('../lib/agent-signal-bus'); } catch { signalBus = null; }

// ─── Contract Addresses ───────────────────────────────────────────────────────

const CONTRACTS = {
  base: {
    aave: {
      pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',    // Aave V3 Pool on Base
      usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',    // USDC on Base
      aUsdc: '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB',   // aUSDC on Base
    },
    compound: {
      cUSDCv3: '0xb125E6687d4313864e53df431d5425969c15Eb2F', // Compound V3 USDC on Base
      usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    },
  },
};

// ─── ABI Fragments ────────────────────────────────────────────────────────────

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const AAVE_POOL_ABI = [
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
];

const COMPOUND_V3_ABI = [
  'function supply(address asset, uint256 amount)',
  'function withdraw(address asset, uint256 amount)',
  'function balanceOf(address account) view returns (uint256)',
];

// ─── State Management ─────────────────────────────────────────────────────────

function createDefaultState() {
  return {
    deposits: [],
    totalDeposited: 0,
    totalWithdrawn: 0,
    estimatedYield: 0,
    lastCheckAt: 0,
    lastDepositAt: 0,
    lastWithdrawAt: 0,
    positions: {},
  };
}

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

function saveState(abs, data) {
  // Trim deposits array to prevent unbounded growth
  if (Array.isArray(data.deposits) && data.deposits.length > 500) {
    data.deposits = data.deposits.slice(-500);
  }
  if (rio) { rio.writeJsonAtomic(abs, data); return; }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = abs + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, abs);
}

// ─── Kill Switch Check ────────────────────────────────────────────────────────

function isKillSwitchActive() {
  // Check risk manager kill switch
  if (riskManager) {
    try {
      if (riskManager.isKillSwitchActive()) return true;
    } catch (err) {
      log.error('riskManager.isKillSwitchActive() threw — failing safe', err);
      return true;
    }
  }
  // Check kill-switch file directly as fallback
  try {
    const ksPath = path.resolve(process.cwd(), 'data/kill-switch.json');
    if (fs.existsSync(ksPath)) {
      const ks = JSON.parse(fs.readFileSync(ksPath, 'utf8'));
      if (ks?.active === true) return true;
    }
  } catch (err) {
    log.error('kill-switch file check threw — failing safe', err);
    return true;
  }
  return false;
}

// ─── RPC Slug Resolution ──────────────────────────────────────────────────────

function getRpcSlug(network) {
  if (network === 'base' || network === 'base-mainnet') return 'base-mainnet';
  if (network === 'ethereum' || network === 'eth-mainnet' || network === 'mainnet') return 'eth-mainnet';
  return 'base-mainnet';
}

// ─── ETH Price for Gas Estimation ─────────────────────────────────────────────

async function getEthUsdPrice() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot', {
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const payload = await res.json();
      const amount = Number(payload?.data?.amount || 0);
      return Number.isFinite(amount) && amount > 0 ? amount : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

// ─── USDC Formatting ──────────────────────────────────────────────────────────

function usdcToUnits(usdAmount) {
  // USDC has 6 decimals: 1 USDC = 1_000_000 units
  return BigInt(Math.floor(usdAmount * 10 ** USDC_DECIMALS));
}

function unitsToUsdc(units) {
  return Number(units) / 10 ** USDC_DECIMALS;
}

// ─── Main Engine ──────────────────────────────────────────────────────────────

async function main() {
  const nowMs = Date.now();

  // 1. Check if enabled
  if (!ENABLED) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'DEFI_YIELD_ENABLED is false' }, null, 2));
    return;
  }

  // 2. Load state and check interval
  const state = loadState();
  const sinceLastCheckSec = state.data.lastCheckAt
    ? Math.floor((nowMs - Number(state.data.lastCheckAt)) / 1000)
    : null;
  if (sinceLastCheckSec !== null && sinceLastCheckSec < CHECK_INTERVAL_SEC) {
    console.log(JSON.stringify({
      status: 'skipped',
      reason: `min-interval-not-met (${sinceLastCheckSec}s/${CHECK_INTERVAL_SEC}s)`,
    }, null, 2));
    return;
  }

  // 3. Validate credentials
  if (!ALCHEMY_API_KEY) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'missing ALCHEMY_API_KEY' }, null, 2));
    return;
  }
  if (!DRY_RUN && !WALLET_PRIVATE_KEY) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'missing WALLET_PRIVATE_KEY (required for live mode)' }, null, 2));
    return;
  }

  // 4. Validate protocol and network
  if (PROTOCOL !== 'aave' && PROTOCOL !== 'compound') {
    console.log(JSON.stringify({ status: 'skipped', reason: `unsupported protocol: ${PROTOCOL}` }, null, 2));
    return;
  }
  const networkContracts = CONTRACTS[NETWORK === 'ethereum' ? 'ethereum' : 'base'];
  if (!networkContracts) {
    console.log(JSON.stringify({ status: 'skipped', reason: `unsupported network: ${NETWORK}` }, null, 2));
    return;
  }
  const protocolContracts = networkContracts[PROTOCOL];
  if (!protocolContracts) {
    console.log(JSON.stringify({ status: 'skipped', reason: `no contracts for ${PROTOCOL} on ${NETWORK}` }, null, 2));
    return;
  }

  // 5. Connect to Base via ethers.js v6 + Alchemy
  const { ethers } = require('ethers');
  const rpcSlug = getRpcSlug(NETWORK);
  const rpcUrl = `https://${rpcSlug}.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = WALLET_PRIVATE_KEY
    ? new ethers.Wallet(WALLET_PRIVATE_KEY, provider)
    : null;

  const walletAddress = wallet ? wallet.address : '0x0000000000000000000000000000000000000000';

  // 6. Capital mandate check — determine mode
  let mandateMode = 'normal';
  let totalCapitalUsd = 0;
  if (capitalMandate) {
    try {
      const capital = capitalMandate.getCurrentCapital();
      totalCapitalUsd = capital.total || 0;
      mandateMode = capitalMandate.determineMode(totalCapitalUsd);
    } catch (err) {
      console.error('[defi-yield] capital mandate error:', err?.message || err);
    }
  }

  // Block deposits in survival or capital_halt mode
  const depositBlocked = mandateMode === 'survival' || mandateMode === 'capital_halt';

  // 7. Kill switch check — auto-withdraw everything if active
  const killSwitchActive = isKillSwitchActive();

  // 8. Read on-chain balances
  const usdcContract = new ethers.Contract(protocolContracts.usdc, ERC20_ABI, wallet || provider);
  let usdcBalanceRaw;
  try {
    usdcBalanceRaw = await usdcContract.balanceOf(walletAddress);
  } catch (err) {
    console.log(JSON.stringify({ status: 'error', reason: `failed to read USDC balance: ${err?.message || err}` }, null, 2));
    return;
  }
  const usdcBalanceUsd = unitsToUsdc(usdcBalanceRaw);

  // 9. Check current DeFi positions
  let currentPositionUsd = 0;
  let currentPositionRaw = BigInt(0);
  try {
    if (PROTOCOL === 'aave') {
      const aUsdcContract = new ethers.Contract(protocolContracts.aUsdc, ERC20_ABI, wallet || provider);
      currentPositionRaw = await aUsdcContract.balanceOf(walletAddress);
      currentPositionUsd = unitsToUsdc(currentPositionRaw);
    } else if (PROTOCOL === 'compound') {
      const compoundContract = new ethers.Contract(protocolContracts.cUSDCv3, COMPOUND_V3_ABI, wallet || provider);
      currentPositionRaw = await compoundContract.balanceOf(walletAddress);
      currentPositionUsd = unitsToUsdc(currentPositionRaw);
    }
  } catch (err) {
    console.error('[defi-yield] position read error:', err?.message || err);
  }

  // Update state positions
  if (!state.data.positions) state.data.positions = {};
  state.data.positions[PROTOCOL] = {
    deposited: state.data.positions[PROTOCOL]?.deposited || 0,
    current: currentPositionUsd,
  };

  // Estimate yield earned
  const depositedForProtocol = state.data.positions[PROTOCOL]?.deposited || 0;
  if (currentPositionUsd > depositedForProtocol && depositedForProtocol > 0) {
    state.data.estimatedYield = (state.data.estimatedYield || 0) + (currentPositionUsd - depositedForProtocol);
    state.data.positions[PROTOCOL].deposited = currentPositionUsd;
  }

  // 10. Calculate limits
  const maxAllowableDefi = totalCapitalUsd > 0 ? totalCapitalUsd * MAX_DEPOSIT_PCT : usdcBalanceUsd * MAX_DEPOSIT_PCT;
  const roomForDeposit = Math.max(0, maxAllowableDefi - currentPositionUsd);

  // 11. Handle kill switch — emergency withdraw
  if (killSwitchActive && currentPositionUsd > 0) {
    console.error('[defi-yield] KILL SWITCH ACTIVE — initiating emergency withdrawal');

    if (DRY_RUN) {
      const result = {
        ts: new Date(nowMs).toISOString(),
        status: 'dry-run-withdraw',
        reason: 'kill_switch_active',
        protocol: PROTOCOL,
        network: NETWORK,
        withdrawAmountUsd: currentPositionUsd,
        dryRun: true,
      };
      state.data.lastCheckAt = nowMs;
      saveState(state.path, state.data);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Execute emergency withdrawal
    const withdrawResult = await executeWithdraw(wallet, provider, protocolContracts, currentPositionRaw, walletAddress);
    state.data.lastCheckAt = nowMs;
    state.data.lastWithdrawAt = nowMs;
    if (withdrawResult.success) {
      state.data.totalWithdrawn = (state.data.totalWithdrawn || 0) + currentPositionUsd;
      state.data.positions[PROTOCOL].deposited = 0;
    }
    saveState(state.path, state.data);

    // Publish withdrawal signal
    if (signalBus) {
      try {
        signalBus.publish({
          type: 'defi_position',
          source: 'defi-yield-engine',
          confidence: 1.0,
          payload: {
            action: 'emergency_withdraw',
            protocol: PROTOCOL,
            network: NETWORK,
            amountUsd: currentPositionUsd,
            reason: 'kill_switch_active',
            txHash: withdrawResult.txHash || null,
          },
        });
      } catch { /* ignore */ }
    }

    console.log(JSON.stringify({
      ts: new Date(nowMs).toISOString(),
      status: withdrawResult.success ? 'withdrawn' : 'withdraw-failed',
      reason: 'kill_switch_active',
      protocol: PROTOCOL,
      network: NETWORK,
      withdrawAmountUsd: currentPositionUsd,
      txHash: withdrawResult.txHash || null,
      error: withdrawResult.error || null,
      dryRun: false,
    }, null, 2));
    return;
  }

  // 12. Handle capital mandate withdrawal — withdraw if mode is survival/capital_halt
  if (depositBlocked && currentPositionUsd > 0) {
    console.error(`[defi-yield] Capital mandate mode "${mandateMode}" — withdrawing DeFi positions`);

    if (DRY_RUN) {
      const result = {
        ts: new Date(nowMs).toISOString(),
        status: 'dry-run-withdraw',
        reason: `mandate_mode_${mandateMode}`,
        protocol: PROTOCOL,
        network: NETWORK,
        withdrawAmountUsd: currentPositionUsd,
        mandateMode,
        dryRun: true,
      };
      state.data.lastCheckAt = nowMs;
      saveState(state.path, state.data);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const withdrawResult = await executeWithdraw(wallet, provider, protocolContracts, currentPositionRaw, walletAddress);
    state.data.lastCheckAt = nowMs;
    state.data.lastWithdrawAt = nowMs;
    if (withdrawResult.success) {
      state.data.totalWithdrawn = (state.data.totalWithdrawn || 0) + currentPositionUsd;
      state.data.positions[PROTOCOL].deposited = 0;
    }
    saveState(state.path, state.data);

    if (signalBus) {
      try {
        signalBus.publish({
          type: 'defi_position',
          source: 'defi-yield-engine',
          confidence: 1.0,
          payload: {
            action: 'mandate_withdraw',
            protocol: PROTOCOL,
            network: NETWORK,
            amountUsd: currentPositionUsd,
            mandateMode,
            txHash: withdrawResult.txHash || null,
          },
        });
      } catch { /* ignore */ }
    }

    console.log(JSON.stringify({
      ts: new Date(nowMs).toISOString(),
      status: withdrawResult.success ? 'withdrawn' : 'withdraw-failed',
      reason: `mandate_mode_${mandateMode}`,
      protocol: PROTOCOL,
      network: NETWORK,
      withdrawAmountUsd: currentPositionUsd,
      mandateMode,
      txHash: withdrawResult.txHash || null,
      error: withdrawResult.error || null,
      dryRun: false,
    }, null, 2));
    return;
  }

  // 13. Check if deposit conditions are met
  if (depositBlocked) {
    const result = {
      ts: new Date(nowMs).toISOString(),
      status: 'skipped',
      reason: `mandate_mode_${mandateMode}_no_deposits`,
      protocol: PROTOCOL,
      network: NETWORK,
      usdcBalanceUsd,
      currentPositionUsd,
      mandateMode,
    };
    state.data.lastCheckAt = nowMs;
    saveState(state.path, state.data);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (usdcBalanceUsd < MIN_IDLE_USD) {
    const result = {
      ts: new Date(nowMs).toISOString(),
      status: 'skipped',
      reason: `idle USDC $${usdcBalanceUsd.toFixed(2)} below minimum $${MIN_IDLE_USD}`,
      protocol: PROTOCOL,
      network: NETWORK,
      usdcBalanceUsd,
      currentPositionUsd,
      maxAllowableDefi,
      roomForDeposit,
    };
    state.data.lastCheckAt = nowMs;
    saveState(state.path, state.data);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (roomForDeposit < MIN_IDLE_USD) {
    const result = {
      ts: new Date(nowMs).toISOString(),
      status: 'skipped',
      reason: `DeFi allocation at max ($${currentPositionUsd.toFixed(2)}/$${maxAllowableDefi.toFixed(2)})`,
      protocol: PROTOCOL,
      network: NETWORK,
      usdcBalanceUsd,
      currentPositionUsd,
      maxAllowableDefi,
      roomForDeposit,
    };
    state.data.lastCheckAt = nowMs;
    saveState(state.path, state.data);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // 14. Calculate deposit amount — never exceed room and never exceed idle balance
  const depositAmountUsd = Math.min(usdcBalanceUsd, roomForDeposit);
  if (depositAmountUsd < MIN_IDLE_USD) {
    const result = {
      ts: new Date(nowMs).toISOString(),
      status: 'skipped',
      reason: `computed deposit $${depositAmountUsd.toFixed(2)} below minimum $${MIN_IDLE_USD}`,
      protocol: PROTOCOL,
      network: NETWORK,
      usdcBalanceUsd,
      currentPositionUsd,
      maxAllowableDefi,
    };
    state.data.lastCheckAt = nowMs;
    saveState(state.path, state.data);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const depositUnits = usdcToUnits(depositAmountUsd);

  // 15. Dry run — log intended action and exit
  if (DRY_RUN) {
    const result = {
      ts: new Date(nowMs).toISOString(),
      status: 'dry-run-deposit',
      protocol: PROTOCOL,
      network: NETWORK,
      depositAmountUsd,
      usdcBalanceUsd,
      currentPositionUsd,
      maxAllowableDefi,
      roomForDeposit,
      mandateMode,
      totalCapitalUsd,
      dryRun: true,
    };
    state.data.lastCheckAt = nowMs;
    saveState(state.path, state.data);

    if (signalBus) {
      try {
        signalBus.publish({
          type: 'defi_position',
          source: 'defi-yield-engine',
          confidence: 0.8,
          payload: {
            action: 'dry_run_deposit',
            protocol: PROTOCOL,
            network: NETWORK,
            amountUsd: depositAmountUsd,
            positionUsd: currentPositionUsd,
          },
        });
      } catch { /* ignore */ }
    }

    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // 16. Gas estimation — abort if gas cost exceeds $2
  if (!wallet) {
    console.log(JSON.stringify({ status: 'error', reason: 'no wallet available for live execution' }, null, 2));
    return;
  }

  let gasCostUsd = 0;
  try {
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || BigInt(0);
    // Aave supply ~ 250k gas, Compound supply ~ 200k gas (conservative estimate)
    const estimatedGasUnits = BigInt(PROTOCOL === 'aave' ? 300000 : 250000);
    const gasCostWei = gasPrice * estimatedGasUnits;
    const gasCostEth = Number(gasCostWei) / 1e18;

    const ethUsd = await getEthUsdPrice();
    if (ethUsd && ethUsd > 0) {
      gasCostUsd = gasCostEth * ethUsd;
    }

    if (gasCostUsd > GAS_MAX_USD) {
      const result = {
        ts: new Date(nowMs).toISOString(),
        status: 'skipped',
        reason: `gas cost $${gasCostUsd.toFixed(4)} exceeds max $${GAS_MAX_USD}`,
        protocol: PROTOCOL,
        network: NETWORK,
        gasCostUsd,
        gasMaxUsd: GAS_MAX_USD,
        depositAmountUsd,
      };
      state.data.lastCheckAt = nowMs;
      saveState(state.path, state.data);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
  } catch (err) {
    console.error('[defi-yield] gas estimation error:', err?.message || err);
    // Proceed cautiously — gas on Base is usually very cheap
  }

  // 17. Approve USDC spending if needed
  const spenderAddress = PROTOCOL === 'aave' ? protocolContracts.pool : protocolContracts.cUSDCv3;
  try {
    const currentAllowance = await usdcContract.allowance(walletAddress, spenderAddress);
    if (currentAllowance < depositUnits) {
      // Approve max uint256 to avoid repeated approvals
      const maxApproval = ethers.MaxUint256;
      const approveTx = await usdcContract.connect(wallet).approve(spenderAddress, maxApproval);
      await approveTx.wait();
    }
  } catch (err) {
    console.log(JSON.stringify({
      status: 'error',
      reason: `USDC approval failed: ${err?.message || err}`,
      protocol: PROTOCOL,
      network: NETWORK,
    }, null, 2));
    return;
  }

  // 18. Execute deposit
  let txHash = null;
  try {
    if (PROTOCOL === 'aave') {
      const poolContract = new ethers.Contract(protocolContracts.pool, AAVE_POOL_ABI, wallet);
      const tx = await poolContract.supply(
        protocolContracts.usdc,  // asset
        depositUnits,            // amount
        walletAddress,           // onBehalfOf
        0,                       // referralCode
      );
      const receipt = await tx.wait();
      txHash = receipt?.hash || tx.hash;
    } else if (PROTOCOL === 'compound') {
      const compoundContract = new ethers.Contract(protocolContracts.cUSDCv3, COMPOUND_V3_ABI, wallet);
      const tx = await compoundContract.supply(
        protocolContracts.usdc,  // asset
        depositUnits,            // amount
      );
      const receipt = await tx.wait();
      txHash = receipt?.hash || tx.hash;
    }
  } catch (err) {
    console.log(JSON.stringify({
      status: 'error',
      reason: `deposit failed: ${err?.message || err}`,
      protocol: PROTOCOL,
      network: NETWORK,
      depositAmountUsd,
    }, null, 2));
    state.data.lastCheckAt = nowMs;
    saveState(state.path, state.data);
    return;
  }

  // 19. Record in state
  state.data.deposits.push({
    protocol: PROTOCOL,
    amount: depositAmountUsd,
    txHash: txHash || 'unknown',
    ts: nowMs,
    apy: MIN_APY, // placeholder — actual APY tracked externally
  });
  state.data.totalDeposited = (state.data.totalDeposited || 0) + depositAmountUsd;
  state.data.lastCheckAt = nowMs;
  state.data.lastDepositAt = nowMs;
  if (!state.data.positions[PROTOCOL]) state.data.positions[PROTOCOL] = {};
  state.data.positions[PROTOCOL].deposited = (state.data.positions[PROTOCOL].deposited || 0) + depositAmountUsd;
  state.data.positions[PROTOCOL].current = currentPositionUsd + depositAmountUsd;
  saveState(state.path, state.data);

  // 20. Publish signal
  if (signalBus) {
    try {
      signalBus.publish({
        type: 'defi_position',
        source: 'defi-yield-engine',
        confidence: 0.9,
        payload: {
          action: 'deposit',
          protocol: PROTOCOL,
          network: NETWORK,
          amountUsd: depositAmountUsd,
          totalPositionUsd: currentPositionUsd + depositAmountUsd,
          txHash,
        },
      });
    } catch { /* ignore */ }
  }

  // 21. Output result
  console.log(JSON.stringify({
    ts: new Date(nowMs).toISOString(),
    status: 'deposited',
    protocol: PROTOCOL,
    network: NETWORK,
    depositAmountUsd,
    txHash,
    usdcBalanceUsd,
    currentPositionUsd,
    newPositionUsd: currentPositionUsd + depositAmountUsd,
    maxAllowableDefi,
    mandateMode,
    totalCapitalUsd,
    gasCostUsd,
    dryRun: false,
    totalDeposited: state.data.totalDeposited,
    totalWithdrawn: state.data.totalWithdrawn,
    estimatedYield: state.data.estimatedYield,
  }, null, 2));
}

// ─── Withdrawal Helper ────────────────────────────────────────────────────────

async function executeWithdraw(wallet, provider, protocolContracts, amountRaw, walletAddress) {
  const { ethers } = require('ethers');
  try {
    // Gas check before withdraw
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || BigInt(0);
    const estimatedGasUnits = BigInt(300000);
    const gasCostWei = gasPrice * estimatedGasUnits;
    const gasCostEth = Number(gasCostWei) / 1e18;
    const ethUsd = await getEthUsdPrice();
    if (ethUsd && gasCostEth * ethUsd > GAS_MAX_USD) {
      return { success: false, error: `gas cost $${(gasCostEth * ethUsd).toFixed(4)} exceeds max $${GAS_MAX_USD}` };
    }

    let txHash = null;
    if (PROTOCOL === 'aave') {
      const poolContract = new ethers.Contract(protocolContracts.pool, AAVE_POOL_ABI, wallet);
      // Withdraw max — use MaxUint256 to withdraw all
      const tx = await poolContract.withdraw(
        protocolContracts.usdc,
        ethers.MaxUint256,
        walletAddress,
      );
      const receipt = await tx.wait();
      txHash = receipt?.hash || tx.hash;
    } else if (PROTOCOL === 'compound') {
      const compoundContract = new ethers.Contract(protocolContracts.cUSDCv3, COMPOUND_V3_ABI, wallet);
      const tx = await compoundContract.withdraw(
        protocolContracts.usdc,
        amountRaw,
      );
      const receipt = await tx.wait();
      txHash = receipt?.hash || tx.hash;
    }

    return { success: true, txHash };
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
