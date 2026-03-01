/**
 * Alchemy API pass-through endpoints
 * GET /api/alchemy/block
 * GET /api/alchemy/balance?address=0x...
 * GET /api/alchemy/nfts?address=0x...
 */

import { getLatestBlock, getBalance, getNFTs, initAlchemy, initRevenueWallet, getRevenueWalletBalance, createRandomWallet, withdrawFromRevenue, distributeRevenue, getGeneratedWalletAddress, getTokenBalances } from '@/lib/alchemy/connector';
import { getAuthorizedRecipients } from '@/lib/alchemy/recipients';
import { sendAlert, getLastAlert } from '@/lib/alerts';
import { readLast } from '@/lib/logger';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const path = url.pathname.replace('/api/alchemy', '');

  try {
    await initAlchemy();

    if (path === '/block') {
      const block = await getLatestBlock();
      return Response.json({ block });
    }

    if (path === '/balance') {
      const address = url.searchParams.get('address');
      if (!address) return Response.json({ error: 'address required' }, { status: 400 });
      const bal = await getBalance(address);
      return Response.json({ balance: bal });
    }

    if (path === '/nfts') {
      const address = url.searchParams.get('address');
      if (!address) return Response.json({ error: 'address required' }, { status: 400 });
      const nfts = await getNFTs(address);
      return Response.json({ nfts });
    }

    // revenue wallet endpoints
    if (path === '/wallet') {
      initRevenueWallet(); // trigger wallet init (may auto-generate if needed)
      const address = initRevenueWallet()?.address || getGeneratedWalletAddress();
      const bal = await getRevenueWalletBalance();
      const recipients = getAuthorizedRecipients();
      // token balances may be null if no tokens configured or error
      const tokenBalances = address ? await getTokenBalances(address) : null;
      return Response.json({ address, balance: bal, recipients, tokenBalances, generated: !process.env.WALLET_PRIVATE_KEY });
    }

    if (path === '/wallet/address') {
      initRevenueWallet(); // trigger wallet init
      const address = initRevenueWallet()?.address || getGeneratedWalletAddress();
      return Response.json({ address, isGenerated: !process.env.WALLET_PRIVATE_KEY });
    }

    if (path === '/wallet/alerts') {
      const alert = getLastAlert();
      return Response.json({ alert });
    }

    if (path === '/wallet/logs') {
      const limit = parseInt(url.searchParams.get('limit') || '200', 10);
      const logs = await readLast(limit);
      return Response.json({ logs });
    }

    if (path === '/health') {
      // simple liveliness/health check for external monitors
      return Response.json({ status: 'ok' });
    }

    if (path === '/debug/auth') {
      // debug auth state
      const dashboardUser = process.env.DASHBOARD_USER || 'admin';
      const dashboardPass = process.env.DASHBOARD_PASS || 'FreedomForge2026';
      const authHeader = req.headers.get('authorization');
      const scheme = authHeader?.split(' ')[0] || null;
      return Response.json({ dashboardUser, dashboardPass, authHeaderPresent: !!authHeader, scheme });
    }

    if (path === '/wallet/create') {
      const wallet = createRandomWallet();
      return Response.json({ wallet });
    }

    if (path === '/wallet/withdraw') {
      const to = url.searchParams.get('to');
      const amount = url.searchParams.get('amount');
      if (!to || !amount) return Response.json({ error: 'to and amount required' }, { status: 400 });
      const tx = await withdrawFromRevenue(to, amount);
      return Response.json({ txHash: tx });
    }

    if (path === '/wallet/distribute') {
      const results = await distributeRevenue();
      if (!results) {
        sendAlert('Revenue distribution returned null (possibly no wallet or no recipients)');
      }
      return Response.json({ results });
    }

    return Response.json({ error: 'unknown alchemy path' }, { status: 404 });
  } catch (error) {
    console.error('Alchemy API error', error);
    return Response.json({ error: 'internal server error' }, { status: 500 });
  }
}
