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
