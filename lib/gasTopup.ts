import { Wallet, formatEther, parseEther } from 'ethers';
import { getRpcProvider, initAlchemy } from './alchemy/connector';
import { sendAlert } from './alerts';
import { logEvent } from './logger';

/**
 * Ensure the revenue wallet has enough ETH for gas. If below threshold,
 * transfer `GAS_TOPUP_AMOUNT` from the funding wallet defined by
 * `FUNDING_PRIVATE_KEY` (env) to the revenue address.
 */
export async function ensureRevenueWalletHasGas(revenueAddress: string): Promise<boolean> {
  const client = initAlchemy();
  if (!client) {
    sendAlert('GasTopup: Alchemy client not initialized');
    return false;
  }

  const provider = getRpcProvider();
  if (!provider) {
    sendAlert('GasTopup: RPC provider not available from Alchemy client config');
    return false;
  }

  const threshold = (process.env.GAS_TOPUP_THRESHOLD || '0.01').trim(); // ETH
  const topupAmount = (process.env.GAS_TOPUP_AMOUNT || '0.05').trim(); // ETH
  const fundingKey = process.env.FUNDING_PRIVATE_KEY?.trim();
  const adaptiveTopupEnabled = (process.env.GAS_TOPUP_ADAPTIVE || 'true').trim().toLowerCase() === 'true';
  const adaptiveBufferEth = (process.env.GAS_TOPUP_BUFFER_ETH || '0.002').trim();
  const maxTopupAmount = process.env.GAS_TOPUP_MAX_AMOUNT?.trim();
  const fundingLowBalanceAlertEth = (process.env.FUNDING_LOW_BALANCE_ALERT_ETH || '0.03').trim();
  const fundingGasReserveEth = (process.env.FUNDING_GAS_RESERVE_ETH || '0.001').trim();

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
      sendAlert(`GasTopup warning: funding wallet low (${formatEther(funderBalWei)} ETH <= ${fundingLowBalanceAlertEth} ETH)`);
      await logEvent('gas_topup_funding_low', {
        funder: funder.address,
        balanceWei: funderBalWei.toString(),
        lowBalanceAlertEth: fundingLowBalanceAlertEth,
      });
    }

    const funderGasReserveWei = parseEther(fundingGasReserveEth);
    if (funderBalWei < topupWei + funderGasReserveWei) {
      const message = `GasTopup blocked: funding wallet too low. Need >= ${formatEther(topupWei + funderGasReserveWei)} ETH, have ${formatEther(funderBalWei)} ETH`;
      sendAlert(message);
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
    await tx.wait();
    const topupEth = formatEther(topupWei);
    sendAlert(`GasTopup: sent ${topupEth} ETH to ${revenueAddress} (tx ${tx.hash})`);
    await logEvent('gas_topup', { to: revenueAddress, amount: topupEth, txHash: tx.hash, funder: funder.address, adaptive: adaptiveTopupEnabled });
    return true;
  } catch (err) {
    console.error('GasTopup error', err);
    sendAlert(`GasTopup error: ${err}`);
    await logEvent('gas_topup_error', { wallet: revenueAddress, error: String(err) });
    return false;
  }
}
