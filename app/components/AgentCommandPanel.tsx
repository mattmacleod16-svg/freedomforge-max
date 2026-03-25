/**
 * AgentCommandPanel — Improved error handling for agent responses
 * ═══════════════════════════════════════════════════════════════════════════
 * Replaces generic "Unable to generate response" with descriptive error recovery
 */

'use client';

import { useState, useCallback, useRef } from 'react';

interface AgentResponse {
  reply: string;
  error?: string;
  metadata?: {
    models_attempted?: string[];
    models_used?: string[];
    reasoning?: string;
  };
}

export function AgentCommandPanel() {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState<AgentResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const sendCommand = useCallback(
    async (messageOverride?: string) => {
      const message = messageOverride || prompt;
      if (!message.trim()) return;

      setLoading(true);
      setResponse(null);

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            message,
            includeSearchResults: true,
            includeKnowledgeBase: true,
          }),
        });

        // Parse response regardless of status code
        const data: AgentResponse = await response.json();

        // Handle both success and error responses
        if (!response.ok) {
          // API returned an error
          setResponse({
            reply: data.reply || data.error || 'Unknown error occurred',
            error: data.error || `HTTP ${response.status}`,
            metadata: data.metadata,
          });

          // Log error details for debugging
          console.error('Agent command failed:', {
            status: response.status,
            error: data.error,
            reasoning: data.metadata?.reasoning,
            attemptedModels: data.metadata?.models_attempted,
          });
        } else {
          // Success response
          setResponse(data);
          setRetryCount(0);

          // Clear input on success
          if (!messageOverride) {
            setPrompt('');
          }
        }
      } catch (error) {
        // Network or parsing error
        const errorMessage = error instanceof Error ? error.message : 'Connection failed';
        setResponse({
          reply: `Failed to connect to agent: ${errorMessage}`,
          error: errorMessage,
        });

        console.error('Network error in agent command:', error);
      } finally {
        setLoading(false);
        scrollToBottom();
      }
    },
    [prompt]
  );

  const handleRetry = useCallback(() => {
    if (retryCount < 3 && response?.error) {
      setRetryCount(retryCount + 1);
      sendCommand(prompt);
    }
  }, [response, retryCount, prompt, sendCommand]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setRetryCount(0);
    sendCommand();
  };

  const renderResponse = () => {
    if (!response) return null;

    const isError = response.error || response.reply.toLowerCase().includes('error') || response.reply.toLowerCase().includes('failed');

    return (
      <div className={`mt-4 p-4 rounded-lg border ${
        isError 
          ? 'border-red-500 bg-red-50 text-red-900' 
          : 'border-blue-500 bg-blue-50 text-blue-900'
      }`}>
        {/* Main response */}
        <div className="font-semibold mb-2">
          {isError ? '⚠️ Response' : '✓ Response'}
        </div>
        <p className="whitespace-pre-wrap mb-3">{response.reply}</p>

        {/* Error details if applicable */}
        {isError && (
          <div className="mt-3 text-sm opacity-75">
            {response.metadata?.models_attempted && (
              <p className="mb-1">
                💔 Attempted models: {response.metadata.models_attempted.join(', ')|| 'unknown'}
              </p>
            )}
            {response.metadata?.reasoning && (
              <p className="mb-1">
                🔍 Reasoning: {response.metadata.reasoning}
              </p>
            )}
            {response.error && (
              <p className="mb-3 font-mono text-xs">
                Error: {response.error}
              </p>
            )}

            {/* Retry guidance */}
            {retryCount < 3 ? (
              <div className="mt-3 space-y-2">
                <p className="font-semibold">🔄 Troubleshooting:</p>
                <ul className="text-xs space-y-1 list-disc list-inside">
                  <li>Check that API keys are configured (OPENROUTER_API_KEY)</li>
                  <li>Verify model availability and rate limits</li>
                  <li>Network connection is stable</li>
                  <li>Try with a simpler prompt</li>
                </ul>
                {retryCount > 0 && (
                  <p className="text-xs">Retry attempt {retryCount}/3</p>
                )}
              </div>
            ) : (
              <p className="mt-3 font-semibold">
                ❌ Max retries reached. Please check API configuration and try again later.
              </p>
            )}
          </div>
        )}

        {/* Metadata (success only) */}
        {!isError && response.metadata?.models_used && (
          <div className="mt-3 text-sm opacity-75 bg-blue-100 p-2 rounded">
            <p>🤖 Models used: {response.metadata.models_used.join(', ')}</p>
          </div>
        )}

        {/* Retry button */}
        {isError && retryCount < 3 && (
          <button
            onClick={handleRetry}
            className="mt-4 px-3 py-1 bg-orange-600 text-white rounded text-sm hover:bg-orange-700 transition"
          >
            🔄 Retry ({retryCount}/3)
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto p-4">
      <div className="flex-1 overflow-y-auto mb-4">
        <h2 className="text-xl font-bold mb-3">Agent Command</h2>
        <p className="text-gray-600 mb-4">Send prompts and review live reasoning output.</p>

        {response && renderResponse()}
        <div ref={messagesEndRef} />
      </div>

      {/* Input form */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask for strategy, prediction, or execution guidance..."
          className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !prompt.trim()}
          className="px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-bold"
        >
          {loading ? '⏳ WAIT' : 'SEND'}
        </button>
      </form>

      {/* Loading indicator */}
      {loading && (
        <div className="mt-3 p-3 bg-gray-100 rounded animate-pulse">
          <p className="text-sm text-gray-600">🤔 Thinking...</p>
        </div>
      )}
    </div>
  );
}

export default AgentCommandPanel;
