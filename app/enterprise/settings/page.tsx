'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

/* ── Types ─────────────────────────────────────────── */

interface ConnectorConfig {
  name: string;
  key: string;
  icon: string;
  description: string;
  envVars: { name: string; description: string; required: boolean; secret: boolean }[];
  docUrl: string;
  status: 'connected' | 'configured' | 'not_configured' | 'error';
}

/* ── Component ─────────────────────────────────────── */

export default function EnterpriseSettingsPage() {
  const [connectors, setConnectors] = useState<ConnectorConfig[]>([]);
  const [selectedConnector, setSelectedConnector] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/enterprise/status');
      const data = await res.json();
      
      const configs: ConnectorConfig[] = [
        {
          name: 'Apriso (DELMIA)',
          key: 'apriso',
          icon: '🔧',
          description: 'Dassault Systèmes DELMIA Apriso MES for production management, shop floor control, and quality.',
          envVars: [
            { name: 'APRISO_API_URL', description: 'Apriso REST API base URL', required: true, secret: false },
            { name: 'APRISO_CLIENT_ID', description: 'OAuth2 Client ID', required: true, secret: false },
            { name: 'APRISO_CLIENT_SECRET', description: 'OAuth2 Client Secret', required: true, secret: true },
            { name: 'APRISO_PLANT', description: 'Default plant code', required: false, secret: false },
            { name: 'APRISO_TIMEOUT', description: 'Request timeout in ms', required: false, secret: false },
          ],
          docUrl: 'https://help.3ds.com/HelpProductsDS.aspx?lvl=1&area=DELMIA',
          status: data.enterprise?.connectors?.apriso?.status === 'connected' ? 'connected' :
                  data.enterprise?.connectors?.apriso ? 'error' : 'not_configured',
        },
        {
          name: 'Oracle Cloud ERP',
          key: 'oracle',
          icon: '🔶',
          description: 'Oracle Fusion Cloud ERP / Manufacturing Cloud for inventory, purchasing, and production.',
          envVars: [
            { name: 'ORACLE_CLOUD_URL', description: 'Oracle Cloud instance URL', required: true, secret: false },
            { name: 'ORACLE_CLIENT_ID', description: 'OAuth2 Client ID', required: true, secret: false },
            { name: 'ORACLE_CLIENT_SECRET', description: 'OAuth2 Client Secret', required: true, secret: true },
            { name: 'ORACLE_TENANT_OCID', description: 'OCI Tenant OCID (optional)', required: false, secret: false },
            { name: 'ORACLE_TIMEOUT', description: 'Request timeout in ms', required: false, secret: false },
          ],
          docUrl: 'https://docs.oracle.com/en/cloud/saas/fusion-applications/',
          status: data.enterprise?.connectors?.oracle?.status === 'connected' ? 'connected' :
                  data.enterprise?.connectors?.oracle ? 'error' : 'not_configured',
        },
        {
          name: 'Windchill PLM',
          key: 'windchill',
          icon: '📐',
          description: 'PTC Windchill for product lifecycle management, BOM, change management, and documents.',
          envVars: [
            { name: 'WINDCHILL_URL', description: 'Windchill server URL', required: true, secret: false },
            { name: 'WINDCHILL_USERNAME', description: 'Service account username', required: true, secret: false },
            { name: 'WINDCHILL_PASSWORD', description: 'Service account password', required: true, secret: true },
            { name: 'WINDCHILL_TIMEOUT', description: 'Request timeout in ms', required: false, secret: false },
          ],
          docUrl: 'https://support.ptc.com/help/windchill/',
          status: data.enterprise?.connectors?.windchill?.status === 'connected' ? 'connected' :
                  data.enterprise?.connectors?.windchill ? 'error' : 'not_configured',
        },
        {
          name: 'NextGenPLM',
          key: 'nextgenplm',
          icon: '🚀',
          description: 'NextGenPLM for modern product lifecycle management with REST API integration.',
          envVars: [
            { name: 'NEXTGENPLM_URL', description: 'NextGenPLM API URL', required: true, secret: false },
            { name: 'NEXTGENPLM_API_KEY', description: 'API Key', required: true, secret: true },
            { name: 'NEXTGENPLM_TIMEOUT', description: 'Request timeout in ms', required: false, secret: false },
          ],
          docUrl: 'https://nextgenplm.com/docs',
          status: data.enterprise?.connectors?.nextgenPlm?.status === 'connected' ? 'connected' :
                  data.enterprise?.connectors?.nextgenPlm ? 'error' : 'not_configured',
        },
      ];
      
      setConnectors(configs);
    } catch (err) {
      console.error('Failed to fetch status:', err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'connected':
        return <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold">✅ Connected</span>;
      case 'configured':
        return <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold">⚠️ Configured (Not Connected)</span>;
      case 'error':
        return <span className="px-3 py-1 rounded-full bg-red-500/20 text-red-400 text-xs font-bold">❌ Error</span>;
      default:
        return <span className="px-3 py-1 rounded-full bg-zinc-500/20 text-zinc-400 text-xs font-bold">🔲 Not Configured</span>;
    }
  };

  const selectedConfig = connectors.find(c => c.key === selectedConnector);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#040112] to-[#080120] p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* ── Header ───────────────────────────────── */}
        <header className="rounded-3xl border border-zinc-800/50 bg-zinc-900/40 backdrop-blur-xl p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/enterprise" className="text-zinc-500 hover:text-white transition">←</Link>
              <span className="text-4xl">⚙️</span>
              <div>
                <h1 className="text-2xl md:text-3xl font-black text-white">
                  Enterprise Settings
                </h1>
                <p className="text-zinc-500 text-sm">
                  Configure connections to PLM/MES systems
                </p>
              </div>
            </div>
            <button
              onClick={fetchStatus}
              className="px-4 py-2 rounded-xl bg-zinc-800/50 hover:bg-zinc-700/50 transition text-sm font-bold text-zinc-300"
            >
              🔄 Refresh
            </button>
          </div>
        </header>

        {loading ? (
          <div className="text-center py-12">
            <div className="text-3xl animate-pulse mb-2">⏳</div>
            <p className="text-zinc-500">Loading configuration...</p>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-6">
            {/* ── Connector List ───────────────────────── */}
            <div className="lg:col-span-1 space-y-3">
              {connectors.map(conn => (
                <button
                  key={conn.key}
                  onClick={() => setSelectedConnector(conn.key)}
                  className={`w-full text-left rounded-xl border p-4 transition ${
                    selectedConnector === conn.key
                      ? 'border-orange-500/50 bg-orange-500/10'
                      : 'border-zinc-700/30 bg-zinc-800/30 hover:bg-zinc-700/30'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{conn.icon}</span>
                      <span className="font-bold text-white">{conn.name}</span>
                    </div>
                    <span className={`w-3 h-3 rounded-full ${
                      conn.status === 'connected' ? 'bg-emerald-500' :
                      conn.status === 'error' ? 'bg-red-500' :
                      conn.status === 'configured' ? 'bg-amber-500' : 'bg-zinc-600'
                    }`} />
                  </div>
                  <p className="text-xs text-zinc-500 line-clamp-2">{conn.description}</p>
                </button>
              ))}
            </div>

            {/* ── Connector Details ────────────────────── */}
            <div className="lg:col-span-2">
              {selectedConfig ? (
                <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/40 p-6 space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <span className="text-4xl">{selectedConfig.icon}</span>
                      <div>
                        <h2 className="text-xl font-bold text-white">{selectedConfig.name}</h2>
                        <p className="text-sm text-zinc-500">{selectedConfig.description}</p>
                      </div>
                    </div>
                    {getStatusBadge(selectedConfig.status)}
                  </div>

                  {/* Environment Variables */}
                  <div>
                    <h3 className="font-bold text-white mb-3">Required Environment Variables</h3>
                    <p className="text-xs text-zinc-500 mb-4">
                      Set these in your <code className="bg-zinc-800 px-1.5 py-0.5 rounded">.env.local</code> file or deployment environment (Railway, Vercel, etc.)
                    </p>
                    <div className="space-y-3">
                      {selectedConfig.envVars.map(envVar => (
                        <div key={envVar.name} className="rounded-xl border border-zinc-700/30 bg-zinc-800/30 p-4">
                          <div className="flex items-center justify-between mb-1">
                            <code className="text-cyan-400 font-bold">{envVar.name}</code>
                            <div className="flex gap-2">
                              {envVar.required && (
                                <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 text-[10px] font-bold">
                                  Required
                                </span>
                              )}
                              {envVar.secret && (
                                <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[10px] font-bold">
                                  🔐 Secret
                                </span>
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-zinc-500">{envVar.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Example Configuration */}
                  <div>
                    <h3 className="font-bold text-white mb-3">Example Configuration</h3>
                    <pre className="rounded-xl bg-zinc-950 border border-zinc-800 p-4 overflow-x-auto text-xs">
                      <code className="text-zinc-300">
{`# ${selectedConfig.name} Configuration
${selectedConfig.envVars.map(v => 
  `${v.name}=${v.secret ? 'your-secret-here' : `your-${v.name.toLowerCase().replace(/_/g, '-')}`}`
).join('\n')}`}
                      </code>
                    </pre>
                  </div>

                  {/* Documentation Link */}
                  <div className="flex items-center justify-between pt-4 border-t border-zinc-800">
                    <a
                      href={selectedConfig.docUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-400 hover:text-blue-300 transition"
                    >
                      📚 View Documentation →
                    </a>
                    <button
                      onClick={() => fetchStatus()}
                      className="px-4 py-2 rounded-xl bg-orange-600/30 text-orange-300 text-sm font-bold hover:bg-orange-600/50 transition"
                    >
                      🔄 Test Connection
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/40 p-12 text-center">
                  <div className="text-5xl mb-4">👈</div>
                  <h3 className="text-xl font-bold text-white mb-2">Select a Connector</h3>
                  <p className="text-zinc-500">Choose a system from the list to view configuration details</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── SSO Configuration Section ──────────────── */}
        <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/40 p-6">
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <span>🔐</span> Enterprise SSO (Coming Soon)
          </h2>
          <p className="text-zinc-500 text-sm mb-4">
            Configure single sign-on with your enterprise identity provider.
          </p>
          <div className="grid md:grid-cols-4 gap-4">
            {[
              { name: 'Azure AD', icon: '🔷', status: 'planned' },
              { name: 'Okta', icon: '🟣', status: 'planned' },
              { name: 'PingFederate', icon: '🔴', status: 'planned' },
              { name: 'SAML 2.0', icon: '🔒', status: 'planned' },
            ].map(sso => (
              <div key={sso.name} className="rounded-xl border border-zinc-700/30 bg-zinc-800/20 p-4 text-center opacity-60">
                <div className="text-2xl mb-2">{sso.icon}</div>
                <div className="font-bold text-zinc-400 text-sm">{sso.name}</div>
                <div className="text-[10px] text-zinc-600 mt-1">Coming Soon</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Help Section ───────────────────────────── */}
        <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/40 p-6">
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <span>💡</span> Need Help?
          </h2>
          <div className="grid md:grid-cols-3 gap-4 text-sm">
            <div className="rounded-xl border border-zinc-700/30 bg-zinc-800/20 p-4">
              <div className="text-xl mb-2">📖</div>
              <div className="font-bold text-white mb-1">Documentation</div>
              <p className="text-zinc-500 text-xs">Read the enterprise integration guide</p>
            </div>
            <div className="rounded-xl border border-zinc-700/30 bg-zinc-800/20 p-4">
              <div className="text-xl mb-2">🛠️</div>
              <div className="font-bold text-white mb-1">Troubleshooting</div>
              <p className="text-zinc-500 text-xs">Common issues and solutions</p>
            </div>
            <div className="rounded-xl border border-zinc-700/30 bg-zinc-800/20 p-4">
              <div className="text-xl mb-2">💬</div>
              <div className="font-bold text-white mb-1">Support</div>
              <p className="text-zinc-500 text-xs">Contact the FreedomForge team</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
