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
import { requireAuth } from '@/lib/auth/apiGuard';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const path = url.pathname.replace('/api/alchemy', '');
  const networkOverride = url.searchParams.get('network') || undefined;

  try {
    await initAlchemy(networkOverride);

    if (path === '/block') {
      const block = await getLatestBlock(networkOverride);
      return Response.json({ block, network: networkOverride || process.env.ALCHEMY_NETWORK || 'eth-mainnet' });
    }

    if (path === '/balance') {
      const address = url.searchParams.get('address');
      if (!address) return Response.json({ error: 'address required' }, { status: 400 });
      const bal = await getBalance(address, networkOverride);
      return Response.json({ balance: bal, network: networkOverride || process.env.ALCHEMY_NETWORK || 'eth-mainnet' });
    }

    if (path === '/nfts') {
      const address = url.searchParams.get('address');
      if (!address) return Response.json({ error: 'address required' }, { status: 400 });
      const nfts = await getNFTs(address, networkOverride);
      return Response.json({ nfts, network: networkOverride || process.env.ALCHEMY_NETWORK || 'eth-mainnet' });
    }

    // revenue wallet endpoints
    if (path === '/wallet') {
      initRevenueWallet(networkOverride); // trigger wallet init (may auto-generate if needed)
      const address = initRevenueWallet(networkOverride)?.address || getGeneratedWalletAddress(networkOverride);
      const bal = await getRevenueWalletBalance(networkOverride);
      const recipients = getAuthorizedRecipients();
      // token balances may be null if no tokens configured or error
      const tokenBalances = address ? await getTokenBalances(address, undefined, networkOverride) : null;
      return Response.json({ address, balance: bal, recipients, tokenBalances, generated: !process.env.WALLET_PRIVATE_KEY, network: networkOverride || process.env.ALCHEMY_NETWORK || 'eth-mainnet' });
    }

    if (path === '/wallet/address') {
      initRevenueWallet(networkOverride); // trigger wallet init
      const address = initRevenueWallet(networkOverride)?.address || getGeneratedWalletAddress(networkOverride);
      return Response.json({ address, isGenerated: !process.env.WALLET_PRIVATE_KEY, network: networkOverride || process.env.ALCHEMY_NETWORK || 'eth-mainnet' });
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
      // FIX HIGH #6: Gate debug endpoint behind auth — don't leak credentials in production
      const denied = await requireAuth(req);
      if (denied) return denied;
      const authHeader = req.headers.get('authorization');
      const scheme = authHeader?.split(' ')[0] || null;
      return Response.json({ authHeaderPresent: !!authHeader, scheme });
    }

    if (path === '/wallet/create') {
      const denied = await requireAuth(req);
      if (denied) return denied;
      const wallet = createRandomWallet();
      return Response.json({ wallet });
    }

    if (path === '/wallet/withdraw') {
      // FIX CRITICAL #2: Reject GET on mutation endpoints — must use POST
      return Response.json({ error: 'use POST for withdraw' }, { status: 405 });
    }

    if (path === '/wallet/distribute') {
      const denied = await requireAuth(req);
      if (denied) return denied;
      const shardParam = url.searchParams.get('shard');
      const shardsParam = url.searchParams.get('shards');
      const botId = url.searchParams.get('botId') || undefined;
      const parsedShardIndex = shardParam !== null ? parseInt(shardParam, 10) : NaN;
      const parsedTotalShards = shardsParam !== null ? parseInt(shardsParam, 10) : NaN;
      const shardIndex = Number.isFinite(parsedShardIndex) ? parsedShardIndex : undefined;
      const totalShards = Number.isFinite(parsedTotalShards) ? parsedTotalShards : undefined;

      const results = await distributeRevenue({
        shardIndex,
        totalShards,
        botId,
        networkOverride,
      });
      if (!results) {
        sendAlert('Revenue distribution returned null (possibly no wallet or no recipients)');
      }
      return Response.json({
        results,
        shardIndex: shardIndex ?? null,
        totalShards: totalShards ?? null,
        botId: botId || null,
        network: networkOverride || process.env.ALCHEMY_NETWORK || 'eth-mainnet',
      });
    }

    return Response.json({ error: 'unknown alchemy path' }, { status: 404 });
  } catch (error) {
    console.error('Alchemy API error', error);
    return Response.json({ error: 'internal server error' }, { status: 500 });
  }
}

// POST handler for mutation operations (withdraw)
export async function POST(req: Request) {
  const url = new URL(req.url);
  const path = url.pathname.replace('/api/alchemy', '');
  const networkOverride = url.searchParams.get('network') || undefined;

  try {
    initAlchemy(networkOverride);
    initRevenueWallet();

    if (path === '/wallet/withdraw') {
      const denied = await requireAuth(req);
      if (denied) return denied;
      const body = await req.json().catch(() => ({}));
      const to = body.to;
      const amount = body.amount;
      if (!to || !amount) return Response.json({ error: 'to and amount required in POST body' }, { status: 400 });
      const tx = await withdrawFromRevenue(to, amount, networkOverride);
      return Response.json({ txHash: tx, network: networkOverride || process.env.ALCHEMY_NETWORK || 'eth-mainnet' });
    }

    return Response.json({ error: 'unknown alchemy POST path' }, { status: 404 });
  } catch (error) {
    console.error('Alchemy API POST error', error);
    return Response.json({ error: 'internal server error' }, { status: 500 });
  }
}
