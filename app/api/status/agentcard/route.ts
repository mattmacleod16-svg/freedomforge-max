/**
 * AgentCard Management API
 * GET  /api/status/agentcard — Get card status, spending, balances
 * POST /api/status/agentcard — Actions: create card, approve/deny topup, run cycle
 */

import { requireAuth } from '@/lib/auth/apiGuard';

export const runtime = 'nodejs';

async function getAgentCardManager() {
  return require('@/lib/funding/agentcard-manager');
}

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  try {
    const manager = await getAgentCardManager();
    const status = manager.getAgentCardStatus();
    const auth = manager.checkAuth();

    return Response.json({
      ok: true,
      ...status,
      auth: {
        installed: auth.installed,
        authenticated: auth.authenticated,
        email: auth.email || null,
      },
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'AgentCard status check failed',
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  try {
    const manager = await getAgentCardManager();
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'status';

    switch (action) {
      case 'create_card': {
        const amount = Math.max(5, Math.min(100, Number(body.amount || 10)));
        const provider = body.provider || 'general';
        const result = manager.createCard(amount, provider);
        return Response.json({ ok: result.success, ...result });
      }

      case 'run_topup_cycle': {
        const result = manager.runAutoTopupCycle();
        return Response.json({ ok: true, ...result });
      }

      case 'approve_topup': {
        const index = Number(body.approvalIndex);
        if (isNaN(index)) {
          return Response.json({ ok: false, error: 'approvalIndex required' }, { status: 400 });
        }
        const result = manager.approveTopup(index);
        return Response.json({ ok: result.success, ...result });
      }

      case 'deny_topup': {
        const index = Number(body.approvalIndex);
        if (isNaN(index)) {
          return Response.json({ ok: false, error: 'approvalIndex required' }, { status: 400 });
        }
        const result = manager.denyTopup(index);
        return Response.json({ ok: true, ...result });
      }

      case 'record_purchase': {
        const provider = body.provider;
        const amount = Number(body.amount);
        if (!provider || isNaN(amount)) {
          return Response.json({ ok: false, error: 'provider and amount required' }, { status: 400 });
        }
        manager.recordCreditPurchase(provider, amount);
        return Response.json({ ok: true, message: `Recorded $${amount} credit purchase for ${provider}` });
      }

      case 'list_cards': {
        const cards = manager.listCards();
        return Response.json({ ok: true, cards });
      }

      default:
        return Response.json(
          { ok: false, error: `Unknown action: ${action}. Valid: create_card, run_topup_cycle, approve_topup, deny_topup, record_purchase, list_cards` },
          { status: 400 },
        );
    }
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'AgentCard action failed',
      },
      { status: 500 },
    );
  }
}
