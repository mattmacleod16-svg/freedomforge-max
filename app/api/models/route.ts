/**
 * GET /api/models — Public API endpoint exposing the AI models registry
 * Used by the marketing showcase page and third-party integrations.
 */

import { AI_MODEL_PROVIDERS, getRegistryStats } from '@/lib/models/aiModelsRegistry';

export const runtime = 'nodejs';

export async function GET() {
  const stats = getRegistryStats();

  return Response.json({
    stats,
    providers: AI_MODEL_PROVIDERS.map((p) => ({
      id: p.id,
      name: p.name,
      tier: p.tier,
      description: p.description,
      website: p.website,
      capabilities: p.capabilities,
      regions: p.regions,
      pricing: p.pricing,
      openSource: p.openSource,
      integrationStatus: p.integrationStatus,
      modelCount: p.models.length,
      models: p.models.map((m) => ({
        id: m.id,
        name: m.name,
        contextWindow: m.contextWindow,
        capabilities: m.capabilities,
        recommended: m.recommended || false,
      })),
    })),
  });
}
