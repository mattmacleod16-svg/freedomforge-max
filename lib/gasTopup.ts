import { Wallet, parseEther } from 'ethers';
import { initAlchemy } from './alchemy/connector';
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

  const provider: any = client.core;
  if (!provider) {
    sendAlert('GasTopup: provider not available from Alchemy client');
    return false;
  }

  const threshold = process.env.GAS_TOPUP_THRESHOLD || '0.01'; // ETH
  const topupAmount = process.env.GAS_TOPUP_AMOUNT || '0.05'; // ETH
  const fundingKey = process.env.FUNDING_PRIVATE_KEY;

  if (!fundingKey) {
    // nothing to do if no funding key configured
    return true;
  }

  try {
    const bal = await provider.getBalance(revenueAddress);
    const balEth = typeof bal === 'bigint' ? Number(bal) / 1e18 : parseFloat(bal.toString()) / 1e18;
    if (balEth > parseFloat(threshold)) return true;

    const funder = new Wallet(fundingKey, provider);
    const tx = await funder.sendTransaction({
      to: revenueAddress,
      value: parseEther(topupAmount),
    });
    await tx.wait();
    sendAlert(`GasTopup: sent ${topupAmount} ETH to ${revenueAddress} (tx ${tx.hash})`);
    await logEvent('gas_topup', { to: revenueAddress, amount: topupAmount, txHash: tx.hash, funder: funder.address });
    return true;
  } catch (err) {
    console.error('GasTopup error', err);
    sendAlert(`GasTopup error: ${err}`);
    await logEvent('gas_topup_error', { wallet: revenueAddress, error: String(err) });
    return false;
  }
}
