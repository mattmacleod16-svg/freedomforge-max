'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

const DEFAULT_GRAFANA_URL = 'http://localhost:3001/d/freedomforge-ops/freedomforge-revenue-bot-ops?orgId=1&refresh=15s';

type AutonomyPolicy = {
  mode: 'assisted' | 'balanced' | 'autonomous';
  autoApproveMinConfidence: number;
  maxRiskForAutoApprove: number;
  alwaysEscalateOnEthicsFlags: boolean;
};

type AutonomyStatus = {
  memorySize: number;
  recentConfidence: number;
  groundTruthSignals: number;
  governance: {
    currentErrorRate: number;
    approvalPolicy: AutonomyPolicy;
  };
};

type RiskStatus = {
  governance: {
    approvalMode: string;
    autoApproveMinConfidence: number | null;
    maxRiskForAutoApprove: number | null;
    currentErrorRate: number | null;
    errorBudget: number | null;
  };
  controls: {
    positionSizeBps: number | null;
    hardStopLossPct: number | null;
    reliability: number | null;
  };
  rollback: {
    triggered: boolean;
    mode: string | null;
    reason: string | null;
  };
  market: {
    regime: string;
    confidence: number | null;
    signals: string[];
  };
  forecast: {
    averageBrierScore: number | null;
    directionalAccuracy: number | null;
    calibrationError: number | null;
    unresolved: number;
  };
};

type ProtocolSnapshot = {
  protocol: string;
  enabled: boolean;
  healthy: boolean | null;
  latencyMs: number | null;
  details: string;
};

type ProtocolStatus = {
  enabled: number;
  healthy: number;
  unhealthy: number;
  protocols: ProtocolSnapshot[];
};

export default function OpsDashboardPage() {
  const router = useRouter();
  const grafanaUrl = process.env.NEXT_PUBLIC_GRAFANA_EMBED_URL || DEFAULT_GRAFANA_URL;
  const [autonomy, setAutonomy] = useState<AutonomyStatus | null>(null);
  const [risk, setRisk] = useState<RiskStatus | null>(null);
  const [protocols, setProtocols] = useState<ProtocolStatus | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const refreshAutonomy = useCallback(async () => {
    const response = await fetch('/api/status/autonomy', { cache: 'no-store' });
    const data = await response.json();
    if (data?.autonomy) {
      setAutonomy(data.autonomy);
    }
  }, []);

  const refreshRisk = useCallback(async () => {
    const response = await fetch('/api/status/risk', { cache: 'no-store' });
    const data = await response.json();
    if (data?.risk) {
      setRisk(data.risk);
    }
  }, []);

  const refreshProtocols = useCallback(async () => {
    const response = await fetch('/api/status/protocols', { cache: 'no-store' });
    const data = await response.json();
    if (data?.status === 'ok' && Array.isArray(data.protocols)) {
      setProtocols({
        enabled: data.enabled ?? 0,
        healthy: data.healthy ?? 0,
        unhealthy: data.unhealthy ?? 0,
        protocols: data.protocols,
      });
    }
  }, []);

  const refreshOpsStatus = useCallback(async () => {
    await Promise.all([refreshAutonomy(), refreshRisk(), refreshProtocols()]);
  }, [refreshAutonomy, refreshRisk, refreshProtocols]);

  useEffect(() => {
    refreshOpsStatus().catch(() => {
      setStatusMessage('Failed to load autonomy status.');
    });
  }, [refreshOpsStatus]);

  useEffect(() => {
    const keepAlive = async () => {
      try {
        const res = await fetch('/api/auth/session', { cache: 'no-store' });
        const data = await res.json();
        if (!data?.authenticated) {
          router.replace('/login?next=/dashboard/ops');
        }
      } catch {
        // no-op
      }
    };

    keepAlive();
    const id = setInterval(keepAlive, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [router]);

  async function setPolicy(mode: 'assisted' | 'balanced' | 'autonomous') {
    setLoading(true);
    setStatusMessage('Updating approval policy...');
    try {
      const response = await fetch('/api/status/autonomy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'update failed');
      setStatusMessage(`Approval mode set to ${data.policy.mode}.`);
      toast.success(`Approval mode set to ${data.policy.mode}`);
      await refreshOpsStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'policy update failed';
      setStatusMessage(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function runGroundTruthSync() {
    setLoading(true);
    setStatusMessage('Syncing external ground-truth feeds...');
    try {
      const response = await fetch('/api/status/autonomy/ground-truth', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'ground-truth sync failed');
      setStatusMessage(`Ground-truth sync complete: ${data.ingested?.length || 0} signals ingested.`);
      await refreshOpsStatus();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'ground-truth sync failed');
    } finally {
      setLoading(false);
    }
  }

  async function runRetrainCheck() {
    setLoading(true);
    setStatusMessage('Running drift retrain check...');
    try {
      const response = await fetch('/api/status/autonomy/retrain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'dashboard_manual' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'retrain check failed');
      setStatusMessage(data?.retrain?.shouldRetrain ? 'Retraining trigger activated.' : 'Retraining not required yet.');
      await refreshOpsStatus();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'retrain check failed');
    } finally {
      setLoading(false);
    }
  }

  async function forceSafeMode() {
    await setPolicy('assisted');
  }

  async function restoreBalancedMode() {
    await setPolicy('balanced');
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-zinc-950 to-black p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-black text-orange-400">📈 Ops Dashboard (Live)</h1>
          <p className="text-gray-300">
            Grafana is embedded below. Configure `NEXT_PUBLIC_GRAFANA_EMBED_URL` to your Oracle VM URL.
          </p>
          <a
            href={grafanaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block w-fit px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded font-bold text-white"
          >
            Open Grafana in New Tab
          </a>
        </div>

        <div className="border border-emerald-500/40 rounded-2xl bg-zinc-900 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setPolicy('assisted')} disabled={loading} className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-white">Assisted</button>
            <button onClick={() => setPolicy('balanced')} disabled={loading} className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-white">Balanced</button>
            <button onClick={() => setPolicy('autonomous')} disabled={loading} className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-white">Autonomous</button>
            <button onClick={runGroundTruthSync} disabled={loading} className="px-3 py-2 bg-blue-700 hover:bg-blue-600 rounded text-white">Sync Ground Truth</button>
            <button onClick={runRetrainCheck} disabled={loading} className="px-3 py-2 bg-amber-700 hover:bg-amber-600 rounded text-white">Retrain Check</button>
          </div>

          <div className="text-sm text-gray-300">
            <div>Mode: <span className="text-white font-semibold">{autonomy?.governance.approvalPolicy.mode || 'loading'}</span></div>
            <div>Confidence: <span className="text-white font-semibold">{autonomy ? autonomy.recentConfidence.toFixed(3) : '—'}</span></div>
            <div>Error Rate: <span className="text-white font-semibold">{autonomy ? autonomy.governance.currentErrorRate.toFixed(3) : '—'}</span></div>
            <div>Memory: <span className="text-white font-semibold">{autonomy?.memorySize ?? '—'}</span> | Ground Truth: <span className="text-white font-semibold">{autonomy?.groundTruthSignals ?? '—'}</span></div>
          </div>

          {statusMessage ? <div className="text-xs text-emerald-300">{statusMessage}</div> : null}
        </div>

        <div className="border border-rose-500/40 rounded-2xl bg-zinc-900 p-4 space-y-2">
          <h2 className="text-lg font-bold text-rose-300">🛡️ Risk Controls</h2>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={forceSafeMode}
              disabled={loading}
              className="px-3 py-2 bg-rose-700 hover:bg-rose-600 rounded text-white font-semibold"
            >
              Force Safe Mode
            </button>
            <button
              onClick={restoreBalancedMode}
              disabled={loading}
              className="px-3 py-2 bg-emerald-700 hover:bg-emerald-600 rounded text-white font-semibold"
            >
              Restore Balanced
            </button>
          </div>
          <div className="text-sm text-gray-300 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
            <div>Mode: <span className="text-white font-semibold">{risk?.governance.approvalMode || '—'}</span></div>
            <div>Rollback: <span className="text-white font-semibold">{risk?.rollback.triggered ? 'ON' : 'OFF'}</span></div>
            <div>Position Size: <span className="text-white font-semibold">{risk?.controls.positionSizeBps ?? '—'} bps</span></div>
            <div>Hard Stop: <span className="text-white font-semibold">{risk?.controls.hardStopLossPct ?? '—'}%</span></div>
            <div>Error Rate/Budget: <span className="text-white font-semibold">{risk?.governance.currentErrorRate ?? '—'} / {risk?.governance.errorBudget ?? '—'}</span></div>
            <div>Calibration (Brier): <span className="text-white font-semibold">{risk?.forecast.averageBrierScore ?? '—'}</span></div>
            <div>Market Regime: <span className="text-white font-semibold">{risk?.market.regime || '—'}</span></div>
            <div>Market Signals: <span className="text-white font-semibold">{risk?.market.signals?.length ?? 0}</span></div>
          </div>
          {risk?.rollback.reason ? <div className="text-xs text-rose-300">Last rollback reason: {risk.rollback.reason}</div> : null}
        </div>

        <div className="border border-purple-500/40 rounded-2xl bg-zinc-900 p-4 space-y-2">
          <h2 className="text-lg font-bold text-purple-300">🔌 Protocol Integrations</h2>
          <div className="text-sm text-gray-300 grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-1">
            <div>Enabled: <span className="text-white font-semibold">{protocols?.enabled ?? 0}</span></div>
            <div>Healthy: <span className="text-emerald-300 font-semibold">{protocols?.healthy ?? 0}</span></div>
            <div>Unhealthy: <span className="text-rose-300 font-semibold">{protocols?.unhealthy ?? 0}</span></div>
          </div>
          <div className="space-y-1 text-sm text-gray-300">
            {(protocols?.protocols || []).map((protocol) => (
              <div key={protocol.protocol} className="flex flex-wrap items-center gap-2">
                <span className="inline-block rounded bg-zinc-800 px-2 py-0.5 font-semibold text-white uppercase">{protocol.protocol}</span>
                <span className={protocol.enabled ? 'text-white' : 'text-zinc-500'}>
                  {protocol.enabled ? 'configured' : 'not configured'}
                </span>
                {protocol.enabled && (
                  <span className={protocol.healthy ? 'text-emerald-300' : 'text-rose-300'}>
                    {protocol.healthy ? 'healthy' : 'unhealthy'}
                  </span>
                )}
                {protocol.latencyMs !== null && <span className="text-zinc-400">({protocol.latencyMs}ms)</span>}
                <span className="text-zinc-400">— {protocol.details}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-blue-500/40 rounded-2xl overflow-hidden bg-zinc-900">
          <iframe
            title="FreedomForge Ops Grafana"
            src={grafanaUrl}
            className="w-full"
            style={{ minHeight: '78vh' }}
          />
        </div>
      </div>
    </div>
  );
}
