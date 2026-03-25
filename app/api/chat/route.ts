/**
 * Enhanced Chat API with Multi-Model, Web Search & RAG
 * POST /api/chat
 * Optional: ?stream=true for Server-Sent Events streaming mode
 */

import { synthesizeAnswer, SYNTHESIS_FALLBACK_RESPONSE } from '@/lib/synthesis/orchestrator';
import { createStreamingResponse } from '@/lib/streaming/chatStreamFormatter';
import {
  buildAgentCommunicationPacket,
  buildAgentToAgentPacket,
  buildAgentUserInteractionPacket,
  buildModelContextPacket,
} from '@/lib/protocols/agentProtocols';
import { requireAuth } from '@/lib/auth/apiGuard';
import { dispatchTask, type TaskType } from '@/lib/intelligence/taskDispatcher';

export const runtime = 'nodejs';

interface ChatRequest {
  message: string;
  includeSearchResults?: boolean;
  includeKnowledgeBase?: boolean;
  stream?: boolean; // Enable SSE streaming instead of complete JSON response
  taskType?: TaskType;
  taskPayload?: Record<string, unknown>;
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
        riskControls?: {
          positionSizeBps: number;
          stopLossPct: number;
          rollbackTriggered: boolean;
          reason?: string;
        };
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
    protocols?: {
      mcp: string;
      acp: string;
      a2a: string;
      aui: string;
      inferredEmotion: 'neutral' | 'positive' | 'concerned' | 'urgent';
    };
    routing_profile?: {
      mode: 'lean' | 'balanced' | 'deep';
      bottom_line_protected: boolean;
      complexity_score: number;
      budget_usd: number;
      estimated_tokens_per_model: number;
      model_budget_cap: number;
      initial_models: number;
      final_models: number;
      escalated: boolean;
      escalation_reasons: string[];
      agreement_score: number;
    };
    task_dispatch?: {
      compartment: TaskType;
      selected_model: string | null;
      selected_adapter: string;
      fallback_used: boolean;
      reason: string;
    };
    interoperability?: {
      detected_language: {
        code: string;
        name: string;
        confidence: number;
      };
      response_language_policy: 'english_us';
      matched_skills: Array<{
        id: string;
        name: string;
        domain: string;
        level: string;
        confidence: number;
      }>;
      unresolved_skill_gaps: Array<{
        id: string;
        name: string;
        domain: string;
        level: string;
        elo: number;
      }>;
      routing_signals: {
        inferred_domains: string[];
        skill_affinity_models: string[];
        language_preferred_models: string[];
        champion: string | null;
        challenger: string | null;
      };
    };
  };
}

function isLowRiskConversationalPrompt(message: string): boolean {
  const text = (message || '').trim().toLowerCase();
  if (!text) return true;
  if (/^(hi|hello|hey|yo|gm|gn|sup|ping|status\??)$/.test(text)) return true;
  if (/^(how are you|what can you do|who are you|thanks|thank you)[\s!?.,]*$/.test(text)) return true;
  return false;
}

export async function POST(req: Request): Promise<Response> {
  // FIX HIGH #4: Auth guard on chat (LLM cost abuse / prompt injection vector)
  const denied = await requireAuth(req);
  if (denied) return denied;
  try {
    const body: ChatRequest = await req.json();
    const { message, stream, taskType, taskPayload } = body;

    if (!message || message.trim().length === 0) {
      return Response.json({ error: 'Message is required' }, { status: 400 });
    }

    // M1 FIX: Cap message length to prevent LLM cost abuse and OOM
    const MAX_MESSAGE_LENGTH = parseInt(process.env.CHAT_MAX_MESSAGE_LENGTH || '10000', 10);
    if (message.length > MAX_MESSAGE_LENGTH) {
      return Response.json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` }, { status: 400 });
    }

    console.log('💬 Processing:', message.substring(0, 100), stream ? '[streaming]' : '');

    // Optional deterministic task dispatch lane for compartmentalized execution.
    if (taskType) {
      const dispatch = await dispatchTask({
        type: taskType,
        prompt: message,
        payload: taskPayload,
      });

      if (!dispatch.ok) {
        return Response.json(
          {
            error: dispatch.error || 'Task dispatch failed',
            metadata: {
              task_dispatch: {
                compartment: dispatch.trace.compartment,
                selected_model: dispatch.trace.selectedModel,
                selected_adapter: dispatch.trace.selectedAdapter,
                fallback_used: dispatch.trace.fallbackUsed,
                reason: dispatch.trace.reason,
              },
            },
          },
          { status: 400 }
        );
      }

      return Response.json({
        reply: typeof dispatch.data === 'string' ? dispatch.data : 'Task executed successfully',
        data: dispatch.data,
        metadata: {
          models_used: dispatch.trace.selectedModel ? [dispatch.trace.selectedModel] : [],
          search_results: 0,
          knowledge_base_hits: 0,
          reasoning: 'Deterministic task dispatcher execution path used.',
          task_dispatch: {
            compartment: dispatch.trace.compartment,
            selected_model: dispatch.trace.selectedModel,
            selected_adapter: dispatch.trace.selectedAdapter,
            fallback_used: dispatch.trace.fallbackUsed,
            reason: dispatch.trace.reason,
          },
        },
      });
    }

    // If streaming requested, return SSE response
    if (stream) {
      return createStreamingResponse(async (emit) => {
        try {
          const result = await synthesizeAnswer(message);

          // Emit partial response as streaming chunk
          emit({
            type: 'token',
            data: {
              reply: result.response,
              sources: result.sources,
              models_used: result.models_used,
              reasoning: result.reasoning,
            },
          });

          // Emit complete metadata
          emit({
            type: 'complete',
            data: {
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
                routing_profile: result.routing_profile,
                interoperability: result.interoperability,
              },
            },
          });
        } catch (err) {
          emit({
            type: 'error',
            data: { error: err instanceof Error ? err.message : 'Unknown error' },
          });
        }
      });
    }

    // Default: Non-streaming JSON response
    // Use the enhanced synthesis system
    const result = await synthesizeAnswer(message);

    // If all model paths failed, return a descriptive 500 instead of surfacing
    // the raw fallback sentinel string to the client.
    if (result.response === SYNTHESIS_FALLBACK_RESPONSE) {
      if (isLowRiskConversationalPrompt(message)) {
        return Response.json({
          reply:
            'Hello! Great to meet you. I can help with strategy, market analysis, tax/legal advisor flows, token insights, and execution planning. Tell me what you want to do next and I will guide you step-by-step.',
          sources: ['interaction://human-first-dialogue'],
          metadata: {
            models_used: [],
            search_results: 0,
            knowledge_base_hits: 0,
            reasoning: 'Low-risk conversational fallback activated for resilient human interaction.',
          },
        });
      }
      const attemptedModels = result.models_used ?? [];
      const userMessage = '⚠️ All AI models failed to respond. Please check your API keys and model availability, or try again.';
      console.error('⚠️ synthesizeAnswer returned fallback — all model paths failed', {
        message: message.substring(0, 100),
        attemptedModels,
        reasoning: result.reasoning,
      });
      return Response.json(
        {
          error: userMessage,
          reply: userMessage,
          metadata: {
            models_attempted: attemptedModels,
          },
        },
        { status: 500 }
      );
    }

    const mcp = buildModelContextPacket({
      query: message,
      sources: result.sources,
    });

    const acp = buildAgentCommunicationPacket({
      from: 'orchestrator',
      to: 'autonomyDirector',
      intent: 'decision_review',
      priority: 'normal',
      body: `confidence=${result.autonomy?.confidence ?? 'n/a'} risk=${result.risk_score ?? 'n/a'}`,
    });

    const a2a = buildAgentToAgentPacket({
      senderAgent: 'adaptiveCortex',
      receiverAgent: 'modelOrchestrator',
      task: 'route_best_models',
      constraints: ['latency-aware', 'risk-aware'],
    });

    const replyText =
      isLowRiskConversationalPrompt(message)
      && result.response.includes('Human-in-the-loop required: elevated ethical or operational risk detected; pause autonomous execution until reviewed.')
        ? result.response.replace(
            'Human-in-the-loop required: elevated ethical or operational risk detected; pause autonomous execution until reviewed.',
            'I am ready to keep helping directly. If you want, I can now walk you through a strategy, growth plan, or execution checklist.'
          )
        : result.response;

    const aui = buildAgentUserInteractionPacket({
      userMessage: message,
      assistantMessage: replyText,
    });

    const response: ChatResponse = {
      reply: replyText,
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
        routing_profile: result.routing_profile,
        interoperability: result.interoperability,
        protocols: {
          mcp: mcp.id,
          acp: acp.id,
          a2a: a2a.id,
          aui: aui.id,
          inferredEmotion: aui.payload.inferredEmotion,
        },
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
