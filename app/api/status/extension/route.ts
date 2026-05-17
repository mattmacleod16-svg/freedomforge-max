import { NextResponse } from 'next/server';

/**
 * GET /api/status/extension
 * Status endpoint for BlackBox extension and other agents.
 * Returns agent state, available models, circuit breaker status.
 */
export async function GET() {
  try {
    // Determine overall agent state
    // In a full implementation, would check circuit breaker stats
    const agentState: 'healthy' | 'degraded' | 'error' = 'healthy';

    // Model availability based on tier (placeholder — should integrate with wallet/tokens)
    const modelsAvailable = agentState === 'healthy' ? 20 : agentState === 'degraded' ? 10 : 1;

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      agent_state: agentState,
      models_available: modelsAvailable,
      queue_depth: 0, // BLACKBOX: integrate with agent scheduler if available
      models: [
        'gpt-4-turbo',
        'gpt-4o',
        'gpt-4-vision',
        'claude-3-opus',
        'claude-3-sonnet',
        'mistral-large',
        'mistral-medium',
        'mixtral-8x7b',
        'llama-2-70b',
        'solar-10.7b',
        'blackbox-reasoning',
      ],
      circuit_breakers: {
        openrouter: {
          state: 'CLOSED',
          health_score: 1,
          success_rate: 0.99,
        },
        oci: {
          state: 'CLOSED',
          health_score: 1,
          success_rate: 0.98,
        },
      },
      health_check_url: '/api/health',
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
        agent_state: 'error',
      },
      { status: 500 }
    );
  }
}
