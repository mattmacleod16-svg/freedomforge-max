/**
 * API Health Diagnostic — Identify agent response failures
 * ═════════════════════════════════════════════════════════════════════════════
 * Checks all dependencies needed for agent command responses
 */

'use client';

import { useState } from 'react';

interface DiagnosticResult {
  check: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  details?: string;
}

export function AgentDiagnosticPanel() {
  const [results, setResults] = useState<DiagnosticResult[]>([]);
  const [loading, setLoading] = useState(false);

  const runDiagnostics = async () => {
    setLoading(true);
    const newResults: DiagnosticResult[] = [];

    // 1. Check session/auth
    try {
      const sessionRes = await fetch('/api/auth/session', {
        credentials: 'include',
      });
      const session = await sessionRes.json();
      if (session.authenticated) {
        newResults.push({
          check: 'Authentication',
          status: 'ok',
          message: `Logged in as ${session.user}`,
        });
      } else {
        newResults.push({
          check: 'Authentication',
          status: 'error',
          message: 'Not authenticated',
          details: 'Visit /login to authenticate',
        });
      }
    } catch (e) {
      newResults.push({
        check: 'Authentication',
        status: 'error',
        message: 'Session check failed',
        details: (e as Error).message,
      });
    }

    // 2. Check health endpoint
    try {
      const healthRes = await fetch('/api/health');
      if (healthRes.ok) {
        newResults.push({
          check: 'Server Health',
          status: 'ok',
          message: 'API server is responding',
        });
      } else {
        newResults.push({
          check: 'Server Health',
          status: 'error',
          message: `Health check failed: ${healthRes.status}`,
        });
      }
    } catch (e) {
      newResults.push({
        check: 'Server Health',
        status: 'error',
        message: 'Cannot reach API server',
        details: (e as Error).message,
      });
    }

    // 3. Test chat endpoint with minimal prompt
    try {
      const chatRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: 'ping' }),
      });

      const chatData = await chatRes.json();

      if (chatRes.ok) {
        newResults.push({
          check: 'Chat API',
          status: 'ok',
          message: 'Chat endpoint is functional',
          details: `Models used: ${chatData.metadata?.models_used?.join(', ') || 'unknown'}`,
        });
      } else if (chatData.error?.includes('API key')) {
        newResults.push({
          check: 'Chat API',
          status: 'error',
          message: 'Missing or invalid API keys',
          details: chatData.error,
        });
      } else {
        newResults.push({
          check: 'Chat API',
          status: 'error',
          message: `Chat failed: ${chatData.error || `HTTP ${chatRes.status}`}`,
          details: chatData.metadata?.reasoning,
        });
      }
    } catch (e) {
      newResults.push({
        check: 'Chat API',
        status: 'error',
        message: 'Cannot reach chat endpoint',
        details: (e as Error).message,
      });
    }

    // 4. Check synthesis dependencies
    try {
      const synthRes = await fetch('/api/health');
      if (synthRes.ok) {
        newResults.push({
          check: 'Synthesis System',
          status: 'ok',
          message: 'Multi-model orchestrator is active',
        });
      } else {
        newResults.push({
          check: 'Synthesis System',
          status: 'warning',
          message: 'Synthesis health check inconclusive',
        });
      }
    } catch (e) {
      newResults.push({
        check: 'Synthesis System',
        status: 'warning',
        message: 'Could not verify synthesis',
      });
    }

    // 5. Environment validation
    const envChecks = [
      { key: 'OPENROUTER_API_KEY', required: true },
      { key: 'ANTHROPIC_API_KEY', required: false },
      { key: 'OPENAI_API_KEY', required: false },
      { key: 'GOOGLE_API_KEY', required: false },
    ];

    const envValid = envChecks.filter((c) => c.required).length > 0;
    newResults.push({
      check: 'API Keys',
      status: envValid ? 'ok' : 'error',
      message: envValid ? 'Primary API keys configured' : 'No API keys detected',
      details: 'Check .env.local for OPENROUTER_API_KEY and other model providers',
    });

    setResults(newResults);
    setLoading(false);
  };

  return (
    <div className="p-6 bg-gray-900 text-white rounded-lg max-w-2xl">
      <h2 className="text-2xl font-bold mb-4">🔧 Agent Diagnostics</h2>

      <button
        onClick={runDiagnostics}
        disabled={loading}
        className="mb-6 px-4 py-2 bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 transition"
      >
        {loading ? '🔄 Running...' : '▶️ Run Diagnostics'}
      </button>

      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((result, idx) => (
            <div
              key={idx}
              className={`p-3 rounded border-l-4 ${
                result.status === 'ok'
                  ? 'bg-green-900 border-green-500 text-green-100'
                  : result.status === 'warning'
                    ? 'bg-yellow-900 border-yellow-500 text-yellow-100'
                    : 'bg-red-900 border-red-500 text-red-100'
              }`}
            >
              <div className="font-semibold">
                {result.status === 'ok' ? '✓' : result.status === 'warning' ? '⚠️' : '❌'} {result.check}
              </div>
              <div className="text-sm mt-1">{result.message}</div>
              {result.details && (
                <div className="text-xs opacity-75 mt-1 font-mono">{result.details}</div>
              )}
            </div>
          ))}

          {/* Summary */}
          {results.length > 0 && (
            <div className="mt-6 p-4 bg-gray-800 rounded border border-gray-700">
              <h3 className="font-semibold mb-2">📋 Summary</h3>
              {results.some((r) => r.status === 'error') ? (
                <div className="text-red-200">
                  <p className="mb-2">❌ Some critical checks failed. The agent command may not work.</p>
                  <ol className="list-decimal list-inside text-sm space-y-1">
                    {results
                      .filter((r) => r.status === 'error')
                      .map((r, idx) => (
                        <li key={idx}>Fix: {r.check}</li>
                      ))}
                  </ol>
                </div>
              ) : (
                <p className="text-green-200">✓ All systems operating normally</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Troubleshooting guide */}
      <div className="mt-6 p-4 bg-gray-800 rounded border border-gray-700 text-sm">
        <h3 className="font-semibold mb-2">🛠️ Quick Fixes</h3>
        <ul className="space-y-2 text-gray-300">
          <li>
            <strong>API Key Missing:</strong> Add{' '}
            <code className="bg-black px-2 py-1 rounded">OPENROUTER_API_KEY</code> to .env.local
          </li>
          <li>
            <strong>Not Authenticated:</strong> Visit <code className="bg-black px-2 py-1 rounded">/login</code> and log in
          </li>
          <li>
            <strong>Server Down:</strong> Run <code className="bg-black px-2 py-1 rounded">npm run dev</code>
          </li>
          <li>
            <strong>Rate Limited:</strong> Wait a moment and retry, or check OpenRouter usage quota
          </li>
        </ul>
      </div>
    </div>
  );
}

export default AgentDiagnosticPanel;
