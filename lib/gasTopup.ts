import { Wallet, formatEther, parseEther } from 'ethers';
import { getRpcProvider, initAlchemy } from './alchemy/connector';
import { sendAlert } from './alerts';
import { logEvent } from './logger';

/**
 * Ensure the revenue wallet has enough ETH for gas. If below threshold,
 * transfer `GAS_TOPUP_AMOUNT` from the funding wallet defined by
 * `FUNDING_PRIVATE_KEY` (env) to the revenue address.
 */
function getNetworkEnvSuffix(networkRaw?: string): string {
  const value = (networkRaw || process.env.ALCHEMY_NETWORK || 'eth-mainnet').toLowerCase();
  if (value === 'mainnet' || value === 'eth-mainnet' || value === 'ethereum') return 'ETH_MAINNET';
  if (value === 'base' || value === 'base-mainnet') return 'BASE_MAINNET';
  if (value === 'op' || value === 'opt-mainnet' || value === 'optimism' || value === 'optimism-mainnet') return 'OPT_MAINNET';
  if (value === 'arb' || value === 'arb-mainnet' || value === 'arbitrum' || value === 'arbitrum-mainnet') return 'ARB_MAINNET';
  if (value === 'polygon' || value === 'polygon-mainnet' || value === 'matic' || value === 'matic-mainnet') return 'POLYGON_MAINNET';
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function getScopedEnv(baseKey: string, networkRaw?: string): string | undefined {
  const scoped = `${baseKey}_${getNetworkEnvSuffix(networkRaw)}`;
  return process.env[scoped] ?? process.env[baseKey];
}

export async function ensureRevenueWalletHasGas(revenueAddress: string, networkOverride?: string): Promise<boolean> {
  const client = initAlchemy(networkOverride);
  if (!client) {
    await sendAlert('GasTopup: Alchemy client not initialized');
    return false;
  }

  const provider = getRpcProvider(networkOverride);
  if (!provider) {
    await sendAlert('GasTopup: RPC provider not available from Alchemy client config');
    return false;
  }

  const threshold = (getScopedEnv('GAS_TOPUP_THRESHOLD', networkOverride) || '0.01').trim(); // native gas token
  const topupAmount = (getScopedEnv('GAS_TOPUP_AMOUNT', networkOverride) || '0.05').trim(); // native gas token
  const fundingKey = process.env.FUNDING_PRIVATE_KEY?.trim();
  const adaptiveTopupEnabled = (getScopedEnv('GAS_TOPUP_ADAPTIVE', networkOverride) || 'true').trim().toLowerCase() === 'true';
  const adaptiveBufferEth = (getScopedEnv('GAS_TOPUP_BUFFER_ETH', networkOverride) || '0.002').trim();
  const maxTopupAmount = getScopedEnv('GAS_TOPUP_MAX_AMOUNT', networkOverride)?.trim();
  const fundingLowBalanceAlertEth = (getScopedEnv('FUNDING_LOW_BALANCE_ALERT_ETH', networkOverride) || '0.03').trim();
  const fundingGasReserveEth = (getScopedEnv('FUNDING_GAS_RESERVE_ETH', networkOverride) || '0.001').trim();

  if (!fundingKey) {
    // nothing to do if no funding key configured
    return true;
  }

  try {
    const thresholdWei = parseEther(threshold);
    const balWei = await provider.getBalance(revenueAddress);
    if (balWei >= thresholdWei) return true;

    const baseTopupWei = parseEther(topupAmount);
    const bufferWei = parseEther(adaptiveBufferEth);
    const neededForThresholdWei = thresholdWei > balWei ? thresholdWei - balWei : BigInt(0);
    let topupWei = adaptiveTopupEnabled
      ? (neededForThresholdWei + bufferWei > baseTopupWei ? neededForThresholdWei + bufferWei : baseTopupWei)
      : baseTopupWei;

    if (maxTopupAmount) {
      const maxTopupWei = parseEther(maxTopupAmount);
      if (topupWei > maxTopupWei) topupWei = maxTopupWei;
    }

    const funder = new Wallet(fundingKey, provider);
    const funderBalWei = await provider.getBalance(funder.address);
    const fundingLowBalanceAlertWei = parseEther(fundingLowBalanceAlertEth);
    if (funderBalWei <= fundingLowBalanceAlertWei) {
      await sendAlert(`GasTopup warning: funding wallet low (${formatEther(funderBalWei)} ETH <= ${fundingLowBalanceAlertEth} ETH)`);
      await logEvent('gas_topup_funding_low', {
        funder: funder.address,
        balanceWei: funderBalWei.toString(),
        lowBalanceAlertEth: fundingLowBalanceAlertEth,
      });
    }

    const funderGasReserveWei = parseEther(fundingGasReserveEth);
    if (funderBalWei < topupWei + funderGasReserveWei) {
      const message = `GasTopup blocked: funding wallet too low. Need >= ${formatEther(topupWei + funderGasReserveWei)} ETH, have ${formatEther(funderBalWei)} ETH`;
      await sendAlert(message);
      await logEvent('gas_topup_blocked_funding', {
        funder: funder.address,
        balanceWei: funderBalWei.toString(),
        requiredWei: (topupWei + funderGasReserveWei).toString(),
        topupWei: topupWei.toString(),
        gasReserveWei: funderGasReserveWei.toString(),
      });
      return false;
    }

    const tx = await funder.sendTransaction({
      to: revenueAddress,
      value: topupWei,
    });
    // Timeout guard: don't wait forever for tx confirmation
    const TX_TIMEOUT_MS = parseInt(process.env.GAS_TOPUP_TX_TIMEOUT_MS || '120000', 10);
    const waitPromise = tx.wait();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`tx.wait() timed out after ${TX_TIMEOUT_MS}ms (tx: ${tx.hash})`)), TX_TIMEOUT_MS)
    );
    await Promise.race([waitPromise, timeoutPromise]);
    const topupEth = formatEther(topupWei);
    await sendAlert(`GasTopup: sent ${topupEth} ETH to ${revenueAddress} (tx ${tx.hash})`);
    await logEvent('gas_topup', { to: revenueAddress, amount: topupEth, txHash: tx.hash, funder: funder.address, adaptive: adaptiveTopupEnabled });
    return true;
  } catch (err) {
    // Sanitize error — strip potential API key URLs from RPC error messages
    const safeErr = String(err).replace(/https?:\/\/[^\s"')]+/g, '[URL_REDACTED]');
    console.error('GasTopup error', safeErr);
    await sendAlert(`GasTopup error: ${safeErr}`);
    await logEvent('gas_topup_error', { wallet: revenueAddress, error: safeErr });
    return false;
  }
}
