/**
 * System Status API
 * GET /api/status - Returns system status and capabilities
 * POST /api/init - Triggers system initialization
 */

import { initializeSystem, isSystemInitialized } from '@/lib/init/systemInit';
import { getAvailableModels } from '@/lib/models/modelOrchestrator';
import { getKnowledgeBaseStats } from '@/lib/rag/vectorStore';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const isReady = isSystemInitialized();
    
    const status = {
      ready: isReady,
      models: isReady ? getAvailableModels() : [],
      knowledgeBase: isReady ? getKnowledgeBaseStats() : null,
      capabilities: {
        multiModel: true,
        webSearch: !!process.env.TAVILY_API_KEY,
        rag: true,
        dataIngestion: process.env.KB_AUTO_LOAD_DATASETS === 'true',
        alchemy: !!process.env.ALCHEMY_API_KEY,
      },
      message: isReady 
        ? '🚀 FreedomForge Max is online and ready!' 
        : '⏳ System initializing...',
    };

    return Response.json(status);
  } catch (error) {
    return Response.json(
      {
        ready: false,
        error: error instanceof Error ? error.message : 'Status check failed',
      },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    console.log('🔄 Manual initialization triggered');
    await initializeSystem();

    return Response.json({
      status: 'initialized',
      message: 'System initialized successfully',
      models: getAvailableModels(),
      knowledgeBase: getKnowledgeBaseStats(),
    });
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Initialization failed',
      },
      { status: 500 }
    );
  }
}
