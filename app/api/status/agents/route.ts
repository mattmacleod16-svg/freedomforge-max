/**
 * Agent Mesh Health Dashboard API
 * GET /api/status/agents - Returns health of all agent subsystems
 *
 * Aggregates health data from:
 *   - Event mesh (pub/sub channels, delivery metrics)
 *   - Consensus engine (voter accuracy, approval rates)
 *   - Agent supervisor (lifecycle, circuit breakers)
 *   - Memory bridge (episodic memory stats)
 *   - Async executor (venue execution metrics)
 *   - Arb detector (opportunity counts)
 *   - Heartbeat registry (agent liveness)
 *   - Signal bus (signal counts by type)
 */

import { requireAuth } from '@/lib/auth/apiGuard';

export const runtime = 'nodejs';

// Dynamic imports — these modules may not exist yet on all environments
async function safeRequire(modulePath: string) {
  try {
    return require(modulePath);
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  try {
    const [
      eventMesh,
      consensusEngine,
      agentSupervisor,
      memoryBridge,
      asyncExecutor,
      arbDetector,
      heartbeatRegistry,
      signalBus,
    ] = await Promise.all([
      safeRequire('@/lib/event-mesh'),
      safeRequire('@/lib/consensus-engine'),
      safeRequire('@/lib/agent-supervisor'),
      safeRequire('@/lib/memory-bridge'),
      safeRequire('@/lib/async-executor'),
      safeRequire('@/lib/arb-detector'),
      safeRequire('@/lib/heartbeat-registry'),
      safeRequire('@/lib/agent-signal-bus'),
    ]);

    const health: Record<string, unknown> = {
      ts: Date.now(),
      uptime: Math.round(process.uptime()),
    };

    // Event Mesh
    if (eventMesh?.getMeshHealth) {
      health.eventMesh = eventMesh.getMeshHealth();
    } else {
      health.eventMesh = { status: 'not_loaded' };
    }

    // Consensus Engine
    if (consensusEngine?.getStats) {
      health.consensus = consensusEngine.getStats();
    } else {
      health.consensus = { status: 'not_loaded' };
    }

    // Agent Supervisor
    if (agentSupervisor?.getStats) {
      health.supervisor = agentSupervisor.getStats();
    } else {
      health.supervisor = { status: 'not_loaded' };
    }

    // Memory Bridge
    if (memoryBridge?.getStats) {
      health.memoryBridge = memoryBridge.getStats();
    } else {
      health.memoryBridge = { status: 'not_loaded' };
    }

    // Async Executor
    if (asyncExecutor?.getStats) {
      health.executor = asyncExecutor.getStats();
    } else {
      health.executor = { status: 'not_loaded' };
    }

    // Arb Detector
    if (arbDetector?.getStats) {
      health.arbDetector = arbDetector.getStats();
    } else {
      health.arbDetector = { status: 'not_loaded' };
    }

    // Heartbeat Registry
    if (heartbeatRegistry?.getHeartbeatSummary) {
      health.heartbeats = heartbeatRegistry.getHeartbeatSummary();
    } else {
      health.heartbeats = { status: 'not_loaded' };
    }

    // Signal Bus
    if (signalBus?.summary) {
      health.signalBus = signalBus.summary();
    } else {
      health.signalBus = { status: 'not_loaded' };
    }

    // Overall system health
    const degradation = agentSupervisor?.getDegradationLevel?.() || { level: 'unknown' };
    health.systemHealth = {
      level: degradation.level,
      deadAgents: degradation.deadAgents || [],
      criticalDead: degradation.criticalDead || [],
    };

    return Response.json(health, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    return Response.json(
      { error: 'Failed to gather agent health', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
