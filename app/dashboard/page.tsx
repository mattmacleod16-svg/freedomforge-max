'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatUnits } from 'ethers';

interface TokenInfo {
  balance: string | null;
  symbol?: string;
  decimals?: number;
}

interface WalletInfo {
  address: string | null;
  balance: string | null;
  recipients: string[];
  tokenBalances?: Record<string, TokenInfo>;
}

export default function DashboardPage() {
  const router = useRouter();
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [latestAlert, setLatestAlert] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchWallet = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/alchemy/wallet');
      const data = await res.json();
      setWallet(data);
    } catch (e) {
      console.error('fetch wallet failed', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchAlert = async () => {
    try {
      const res = await fetch('/api/alchemy/wallet/alerts');
      const { alert } = await res.json();
      if (alert && alert.message) {
        setLatestAlert(`${new Date(alert.time).toLocaleString()}: ${alert.message}`);
      }
    } catch (e) {
      console.error('fetch alert failed', e);
    }
  };

  useEffect(() => {
    fetchWallet();
    fetchAlert();
    const id = setInterval(() => {
      fetchWallet();
      fetchAlert();
    }, 15000);
    return () => clearInterval(id);
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-zinc-950 to-black p-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8 flex items-center justify-between gap-4">
          <h1 className="text-4xl font-black text-orange-400">🚀 FreedomForge Max Revenue Monitor</h1>
          <button
            onClick={handleLogout}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:border-orange-500 hover:text-orange-300"
          >
            Logout
          </button>
        </div>

        <div className="grid gap-6">
          {/* Wallet Info */}
          <div className="bg-zinc-900 border border-orange-500/30 rounded-2xl p-6">
            <h2 className="text-2xl font-bold text-white mb-4">💰 Revenue Wallet</h2>
            {loading ? (
              <p className="text-gray-400">Loading...</p>
            ) : wallet ? (
              <div className="space-y-3">
                <p className="text-gray-300">
                  <strong>Address:</strong> <code className="text-orange-400 break-all">{wallet.address}</code>
                </p>
                <p className="text-gray-300">
                  <strong>Balance:</strong>{' '}
                  <span className="text-green-400 font-mono">
                    {wallet.balance
                      ? `${(parseFloat(wallet.balance) / 1e18).toFixed(6)} ETH`
                      : '—'}
                  </span>
                </p>
                <p className="text-gray-300">
                  <strong>Recipients:</strong> {wallet.recipients.length > 0 ? wallet.recipients.join(', ') : 'None configured'}
                </p>
                {wallet.tokenBalances && Object.keys(wallet.tokenBalances).length > 0 && (
                  <div className="pt-2">
                    <strong className="text-gray-300">Token Balances:</strong>
                    <ul className="list-disc list-inside text-gray-300 ml-4">
                      {Object.entries(wallet.tokenBalances).map(([addr, info]) => {
                        let display = '—';
                        if (info.balance) {
                          if (info.decimals !== undefined) {
                            try {
                              display = formatUnits(info.balance, info.decimals);
                            } catch {
                              display = info.balance;
                            }
                          } else {
                            display = info.balance;
                          }
                          if (info.symbol) display += ` ${info.symbol}`;
                        }
                        return (
                          <li key={addr}>
                            <code className="text-orange-400 break-all">{info.symbol || addr}</code>: {display}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-red-400">Failed to load wallet data</p>
            )}
          </div>

          {/* Latest Alert */}
          {latestAlert && (
            <div className="bg-red-900/30 border border-red-500/50 rounded-2xl p-6">
              <h2 className="text-2xl font-bold text-red-400 mb-2">⚠️ Latest Alert</h2>
              <p className="text-gray-200">{latestAlert}</p>
            </div>
          )}

          {/* Logs Link */}
          <div className="bg-zinc-900 border border-blue-500/30 rounded-2xl p-6">
            <h2 className="text-2xl font-bold text-blue-400 mb-4">📝 Logs</h2>
            <p className="text-gray-300 mb-4">View detailed transaction logs:</p>
            <a
              href="/api/alchemy/wallet/logs?limit=50"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded font-bold text-white"
            >
              View Recent Logs
            </a>
          </div>

          {/* Instructions */}
          <div className="bg-zinc-900 border border-gray-500/30 rounded-2xl p-6">
            <h2 className="text-2xl font-bold text-white mb-4">📌 Setup Instructions</h2>
            <ol className="space-y-2 text-gray-300 list-decimal list-inside">
              <li>Fund the wallet address above with Base ETH</li>
              <li>Revenue will begin flowing to your recipient address automatically</li>
              <li>Check logs or alerts for transaction details</li>
              <li>System runs 24/7 with automatic gas top-ups (if configured)</li>              <li>If you set `TRACKED_TOKENS`, their balances show above</li>            </ol>
          </div>

          {/* Refresh Button */}
          <button
            onClick={() => {
              fetchWallet();
              fetchAlert();
            }}
            className="px-6 py-3 bg-orange-600 hover:bg-orange-700 rounded-xl text-white font-bold"
          >
            🔄 Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
