/**
 * System Status API
 * GET /api/status - Returns system status and capabilities
 * POST /api/init - Triggers system initialization
 */

import { initializeSystem, isSystemInitialized } from '@/lib/init/systemInit';
import { getAvailableModels } from '@/lib/models/modelOrchestrator';
import { getKnowledgeBaseStats } from '@/lib/rag/vectorStore';
import { getMarketIntelligenceSummary, maybeRefreshMarketFeatureStore } from '@/lib/intelligence/marketFeatureStore';
import { getForecastSummary, resolveDueForecasts } from '@/lib/intelligence/forecastEngine';
import { getChampionPolicySnapshot } from '@/lib/intelligence/championPolicy';
import { getRiskStatusSummary } from '@/lib/intelligence/riskMonitor';
import { getMemorySummary } from '@/lib/intelligence/memoryEngine';
import { getAdaptiveOpportunityPlan } from '@/lib/intelligence/opportunityEngine';
import { getProtocolSummary } from '@/lib/protocols/adapters';
import { getVendorStackStatus } from '@/lib/intelligence/vendorStack';
import { getXAutomationStatus } from '@/lib/social/xAutomation';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const detectedModels = getAvailableModels();
    const isReady = isSystemInitialized() || detectedModels.length > 0;
    const [protocolStatus, vendorStack] = await Promise.all([
      getProtocolSummary(),
      getVendorStackStatus(),
    ]);
    const xAutomation = getXAutomationStatus();
    if (isReady) {
      await maybeRefreshMarketFeatureStore();
      await resolveDueForecasts();
    }
    
    const status = {
      ready: isReady,
      models: detectedModels,
      knowledgeBase: isReady ? getKnowledgeBaseStats() : null,
      market: isReady ? getMarketIntelligenceSummary() : null,
      forecast: isReady ? getForecastSummary() : null,
      modelPolicy: isReady ? getChampionPolicySnapshot() : null,
      risk: isReady ? await getRiskStatusSummary() : null,
      memory: isReady ? getMemorySummary() : null,
      opportunities: isReady ? getAdaptiveOpportunityPlan().summary : null,
      protocols: protocolStatus,
      vendorStack,
      xAutomation,
      capabilities: {
        multiModel: true,
        webSearch: !!process.env.TAVILY_API_KEY,
        rag: true,
        dataIngestion: process.env.KB_AUTO_LOAD_DATASETS === 'true',
        alchemy: !!process.env.ALCHEMY_API_KEY,
        marketIntelligence: true,
        probabilisticForecasting: true,
        riskControls: true,
        episodicMemory: true,
        adaptiveOpportunities: true,
        textFirstInteraction: true,
        xGrowthAutomation: true,
        zoraProtocol: protocolStatus.protocols.some((item) => item.protocol === 'zora' && item.enabled),
        vvvProtocol: protocolStatus.protocols.some((item) => item.protocol === 'vvv' && item.enabled),
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
