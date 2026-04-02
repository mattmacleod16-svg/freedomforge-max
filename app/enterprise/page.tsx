'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

/* ── Types ─────────────────────────────────────────── */

interface ConnectorStatus {
  status: 'connected' | 'disconnected' | 'error' | 'connecting';
  latencyMs?: number;
  lastCheck: string;
  error?: string;
}

interface EnterpriseStatus {
  overall: 'healthy' | 'degraded' | 'offline';
  connectedSystems: string[];
  totalSystems: number;
  lastUpdated: string;
  connectors: {
    apriso: ConnectorStatus | null;
    oracle: ConnectorStatus | null;
    windchill: ConnectorStatus | null;
    nextgenPlm: ConnectorStatus | null;
  };
}

interface DashboardStats {
  workOrders: { active: number; completed: number; onHold: number };
  inventory: { lowStock: number; totalItems: number };
  quality: { openNCRs: number; activeHolds: number };
  production: { efficiency: number; oee: number };
}

/* ── Component ─────────────────────────────────────── */

export default function EnterpriseDashboard() {
  const [status, setStatus] = useState<EnterpriseStatus | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/enterprise/status');
      const data = await res.json();
      
      if (data.status === 'ok' && data.enterprise) {
        setStatus(data.enterprise);
        // Mock stats for demo - in production, these would come from actual API calls
        setStats({
          workOrders: { active: 47, completed: 156, onHold: 3 },
          inventory: { lowStock: 12, totalItems: 2847 },
          quality: { openNCRs: 5, activeHolds: 2 },
          production: { efficiency: 94.2, oee: 87.5 },
        });
      } else {
        setError(data.error || 'Failed to fetch status');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#050118] to-[#030108] flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-pulse">🏭</div>
          <p className="text-zinc-400 animate-pulse">Loading Enterprise Systems…</p>
        </div>
      </div>
    );
  }

  const getStatusColor = (s: 'healthy' | 'degraded' | 'offline' | string) => {
    switch (s) {
      case 'healthy':
      case 'connected':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
      case 'degraded':
      case 'connecting':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      case 'offline':
      case 'error':
      case 'disconnected':
        return 'text-red-400 bg-red-500/10 border-red-500/30';
      default:
        return 'text-zinc-400 bg-zinc-500/10 border-zinc-500/30';
    }
  };

  const connectorCards = [
    { key: 'apriso', name: 'Apriso (DELMIA)', icon: '🔧', description: 'MES • Shop Floor • Quality', link: '/enterprise/mes' },
    { key: 'oracle', name: 'Oracle ERP', icon: '🔶', description: 'Inventory • Purchasing • Manufacturing', link: '/enterprise/mes' },
    { key: 'windchill', name: 'Windchill PLM', icon: '📐', description: 'BOM • ECN • Documents', link: '/enterprise/plm' },
    { key: 'nextgenPlm', name: 'NextGenPLM', icon: '🚀', description: 'Items • Workflows • Lifecycle', link: '/enterprise/plm' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#040112] to-[#080120] p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* ── Header ───────────────────────────────── */}
        <header className="rounded-3xl border border-zinc-800/50 bg-zinc-900/40 backdrop-blur-xl p-6 md:p-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-5xl">🏭</span>
              <div>
                <h1 className="text-3xl md:text-4xl font-black tracking-tight bg-gradient-to-r from-orange-400 via-amber-400 to-yellow-400 bg-clip-text text-transparent">
                  Enterprise Integration Hub
                </h1>
                <p className="text-zinc-500 text-sm mt-1">
                  PLM/MES System Control Center • Apriso • Oracle • Windchill • NextGenPLM
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`px-4 py-2 rounded-xl border font-bold text-sm ${getStatusColor(status?.overall || 'offline')}`}>
                {status?.overall === 'healthy' ? '✅ All Systems Operational' :
                 status?.overall === 'degraded' ? '⚠️ Degraded' : '❌ Offline'}
              </span>
              <button
                onClick={fetchStatus}
                className="p-2 rounded-xl bg-zinc-800/50 hover:bg-zinc-700/50 transition text-zinc-400 hover:text-white"
                title="Refresh Status"
              >
                🔄
              </button>
            </div>
          </div>

          {/* Quick Stats */}
          {stats && (
            <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
                <div className="text-2xl font-black text-blue-400">{stats.workOrders.active}</div>
                <div className="text-xs text-zinc-500">Active Work Orders</div>
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                <div className="text-2xl font-black text-emerald-400">{stats.production.oee}%</div>
                <div className="text-xs text-zinc-500">OEE Score</div>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                <div className="text-2xl font-black text-amber-400">{stats.inventory.lowStock}</div>
                <div className="text-xs text-zinc-500">Low Stock Items</div>
              </div>
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                <div className="text-2xl font-black text-red-400">{stats.quality.openNCRs}</div>
                <div className="text-xs text-zinc-500">Open NCRs</div>
              </div>
            </div>
          )}
        </header>

        {/* ── System Connectors ─────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span>🔌</span> Connected Systems
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {connectorCards.map(connector => {
              const connectorStatus = status?.connectors[connector.key as keyof typeof status.connectors];
              const isConfigured = connectorStatus !== null;
              const isConnected = connectorStatus?.status === 'connected';

              return (
                <Link
                  key={connector.key}
                  href={isConfigured ? connector.link : '/enterprise/settings'}
                  className={`rounded-2xl border p-5 transition hover:scale-[1.02] ${
                    isConnected 
                      ? 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10' 
                      : isConfigured 
                        ? 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10'
                        : 'border-zinc-700/30 bg-zinc-800/20 hover:bg-zinc-800/40'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <span className="text-3xl">{connector.icon}</span>
                    <span className={`w-3 h-3 rounded-full ${
                      isConnected ? 'bg-emerald-500 animate-pulse' :
                      isConfigured ? 'bg-amber-500' : 'bg-zinc-600'
                    }`} />
                  </div>
                  <h3 className="font-bold text-white mb-1">{connector.name}</h3>
                  <p className="text-xs text-zinc-500 mb-3">{connector.description}</p>
                  {isConfigured && connectorStatus && (
                    <div className="text-[10px] text-zinc-500">
                      {isConnected ? (
                        <span className="text-emerald-400">
                          Connected • {connectorStatus.latencyMs}ms
                        </span>
                      ) : (
                        <span className="text-amber-400">
                          {connectorStatus.error || 'Connecting...'}
                        </span>
                      )}
                    </div>
                  )}
                  {!isConfigured && (
                    <div className="text-[10px] text-zinc-500">
                      Click to configure →
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        </section>

        {/* ── Quick Actions ─────────────────────────── */}
        <section className="grid md:grid-cols-2 gap-6">
          {/* MES Module */}
          <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/40 p-6">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
              <span>🔧</span> MES — Manufacturing Execution
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <Link href="/enterprise/mes?tab=workorders" className="rounded-xl border border-zinc-700/30 bg-zinc-800/30 p-4 hover:bg-zinc-700/30 transition">
                <div className="text-2xl mb-2">📋</div>
                <div className="font-bold text-white text-sm">Work Orders</div>
                <div className="text-[10px] text-zinc-500">View & manage</div>
              </Link>
              <Link href="/enterprise/mes?tab=operations" className="rounded-xl border border-zinc-700/30 bg-zinc-800/30 p-4 hover:bg-zinc-700/30 transition">
                <div className="text-2xl mb-2">⚙️</div>
                <div className="font-bold text-white text-sm">Shop Floor</div>
                <div className="text-[10px] text-zinc-500">Operations control</div>
              </Link>
              <Link href="/enterprise/mes?tab=quality" className="rounded-xl border border-zinc-700/30 bg-zinc-800/30 p-4 hover:bg-zinc-700/30 transition">
                <div className="text-2xl mb-2">✅</div>
                <div className="font-bold text-white text-sm">Quality</div>
                <div className="text-[10px] text-zinc-500">NCRs & holds</div>
              </Link>
              <Link href="/enterprise/mes?tab=inventory" className="rounded-xl border border-zinc-700/30 bg-zinc-800/30 p-4 hover:bg-zinc-700/30 transition">
                <div className="text-2xl mb-2">📦</div>
                <div className="font-bold text-white text-sm">Inventory</div>
                <div className="text-[10px] text-zinc-500">Stock levels</div>
              </Link>
            </div>
          </div>

          {/* PLM Module */}
          <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/40 p-6">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
              <span>📐</span> PLM — Product Lifecycle
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <Link href="/enterprise/plm?tab=bom" className="rounded-xl border border-zinc-700/30 bg-zinc-800/30 p-4 hover:bg-zinc-700/30 transition">
                <div className="text-2xl mb-2">🧱</div>
                <div className="font-bold text-white text-sm">BOM Manager</div>
                <div className="text-[10px] text-zinc-500">Bill of materials</div>
              </Link>
              <Link href="/enterprise/plm?tab=ecn" className="rounded-xl border border-zinc-700/30 bg-zinc-800/30 p-4 hover:bg-zinc-700/30 transition">
                <div className="text-2xl mb-2">🔄</div>
                <div className="font-bold text-white text-sm">Change Orders</div>
                <div className="text-[10px] text-zinc-500">ECN / ECR</div>
              </Link>
              <Link href="/enterprise/plm?tab=documents" className="rounded-xl border border-zinc-700/30 bg-zinc-800/30 p-4 hover:bg-zinc-700/30 transition">
                <div className="text-2xl mb-2">📄</div>
                <div className="font-bold text-white text-sm">Documents</div>
                <div className="text-[10px] text-zinc-500">CAD, specs, drawings</div>
              </Link>
              <Link href="/enterprise/plm?tab=workflows" className="rounded-xl border border-zinc-700/30 bg-zinc-800/30 p-4 hover:bg-zinc-700/30 transition">
                <div className="text-2xl mb-2">🔀</div>
                <div className="font-bold text-white text-sm">Workflows</div>
                <div className="text-[10px] text-zinc-500">Approvals & tasks</div>
              </Link>
            </div>
          </div>
        </section>

        {/* ── Navigation Footer ─────────────────────── */}
        <footer className="flex justify-center gap-4 pt-4">
          <Link href="/enterprise/settings" className="px-6 py-3 rounded-xl bg-zinc-800/50 hover:bg-zinc-700/50 transition text-sm font-bold text-zinc-300">
            ⚙️ Settings
          </Link>
          <Link href="/industrial" className="px-6 py-3 rounded-xl bg-zinc-800/50 hover:bg-zinc-700/50 transition text-sm font-bold text-zinc-300">
            🏭 Industrial Hub
          </Link>
          <Link href="/dashboard" className="px-6 py-3 rounded-xl bg-zinc-800/50 hover:bg-zinc-700/50 transition text-sm font-bold text-zinc-300">
            📊 Trading Dashboard
          </Link>
        </footer>

        {/* ── Error Display ───────────────────────── */}
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-400 text-sm">
            ⚠️ {error}
          </div>
        )}
      </div>
    </div>
  );
}
