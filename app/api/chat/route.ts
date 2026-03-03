/**
 * Enhanced Chat API with Multi-Model, Web Search & RAG
 * POST /api/chat
 */

import { synthesizeAnswer } from '@/lib/synthesis/orchestrator';

export const runtime = 'nodejs';

interface ChatRequest {
  message: string;
  includeSearchResults?: boolean;
  includeKnowledgeBase?: boolean;
}

interface ChatResponse {
  reply: string;
  sources?: string[];
  metadata?: {
    models_used: string[];
    search_results: number;
    knowledge_base_hits: number;
    reasoning: string;
    risk_score?: number;
    drift_score?: number;
    xai?: {
      decision_id: string;
      selected_action: string;
      epsilon: number;
      contributions: Record<string, number>;
      agent_outputs: Record<string, string>;
    };
    autonomy?: {
      confidence: number;
      jury_decision: 'approve' | 'revise' | 'escalate';
      retrain_triggered: boolean;
      goals: Array<{
        id: string;
        label: string;
        objective: string;
        priority: number;
        horizon: string;
      }>;
      cost_estimate: {
        tokens_approx: number;
        estimated_usd: number;
      };
      reliability: {
        error_rate: number;
        within_budget: boolean;
        recovery_mode: boolean;
      };
      finance_autonomy: {
        mode: 'monitor' | 'autopilot';
        actions: string[];
      };
      prediction_autonomy: {
        readiness: number;
        signals_used: number;
      };
      symbiosis: {
        human_required: boolean;
        reason?: string;
      };
      ethical_alignment: {
        score: number;
        flags: string[];
      };
      team_reviews: Array<{
        team: string;
        verdict: string;
        score: number;
      }>;
    };
  };
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body: ChatRequest = await req.json();
    const { message } = body;

    if (!message || message.trim().length === 0) {
      return Response.json({ error: 'Message is required' }, { status: 400 });
    }

    console.log('💬 Processing:', message.substring(0, 100));

    // Use the enhanced synthesis system
    const result = await synthesizeAnswer(message);

    const response: ChatResponse = {
      reply: result.response,
      sources: result.sources,
      metadata: {
        models_used: result.models_used,
        search_results: result.search_results,
        knowledge_base_hits: result.knowledge_base_hits,
        reasoning: result.reasoning,
        risk_score: result.risk_score,
        drift_score: result.drift_score,
        xai: result.xai,
        autonomy: result.autonomy,
      },
    };

    return Response.json(response);
  } catch (error) {
    console.error('Chat API error:', error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
        reply: "Max encountered an issue. Please try again or ensure your API keys are configured.",
      },
      { status: 500 }
    );
  }
}
