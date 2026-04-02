/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — Apriso API
   
   REST API for Apriso (DELMIA) MES integration
   Endpoints:
   - GET: Fetch work orders, operations, quality holds
   - POST: Execute actions (start/complete operations, submit NCRs)
   ═══════════════════════════════════════════════════════════════════════════ */

import { NextResponse } from 'next/server';
import { enterprise } from '@/lib/enterprise';
import type { WorkOrderStatus, OperationResult, NonConformanceReport, ScrapData } from '@/lib/enterprise';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ─────────────────────────────────────────────────────────────────────────────
// GET — Fetch data from Apriso
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    await enterprise.initialize();
    
    const apriso = enterprise.apriso;
    if (!apriso) {
      return NextResponse.json(
        { status: 'error', error: 'Apriso connector not configured' },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(request.url);
    const resource = searchParams.get('resource') || 'workorders';

    switch (resource) {
      case 'workorders': {
        const filters = {
          status: searchParams.get('status') as WorkOrderStatus | undefined,
          partNumber: searchParams.get('partNumber') || undefined,
          productionLine: searchParams.get('productionLine') || undefined,
          workCenter: searchParams.get('workCenter') || undefined,
          search: searchParams.get('search') || undefined,
          page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : 1,
          pageSize: searchParams.get('pageSize') ? parseInt(searchParams.get('pageSize')!, 10) : 50,
          plant: searchParams.get('plant') || undefined,
        };

        const workOrders = await apriso.getWorkOrders(filters);
        return NextResponse.json({ status: 'ok', ...workOrders });
      }

      case 'workorder': {
        const id = searchParams.get('id');
        if (!id) {
          return NextResponse.json({ status: 'error', error: 'Missing id parameter' }, { status: 400 });
        }
        const workOrder = await apriso.getWorkOrder(id);
        return NextResponse.json({ status: 'ok', data: workOrder });
      }

      case 'operations': {
        const workOrderId = searchParams.get('workOrderId') || undefined;
        const operations = await apriso.getOperations(workOrderId);
        return NextResponse.json({ status: 'ok', data: operations });
      }

      case 'holds': {
        const filters = {
          status: searchParams.get('status') || undefined,
          severity: searchParams.get('severity') || undefined,
          partNumber: searchParams.get('partNumber') || undefined,
          page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : 1,
          pageSize: searchParams.get('pageSize') ? parseInt(searchParams.get('pageSize')!, 10) : 50,
        };

        const holds = await apriso.getQualityHolds(filters as Parameters<typeof apriso.getQualityHolds>[0]);
        return NextResponse.json({ status: 'ok', ...holds });
      }

      case 'materials': {
        const workOrderId = searchParams.get('workOrderId');
        if (!workOrderId) {
          return NextResponse.json({ status: 'error', error: 'Missing workOrderId parameter' }, { status: 400 });
        }
        const materials = await apriso.getMaterialConsumption(workOrderId);
        return NextResponse.json({ status: 'ok', data: materials });
      }

      case 'workcenters': {
        const plant = searchParams.get('plant') || undefined;
        const workCenters = await apriso.getWorkCenters(plant);
        return NextResponse.json({ status: 'ok', data: workCenters });
      }

      case 'metrics': {
        const plant = searchParams.get('plant');
        if (!plant) {
          return NextResponse.json({ status: 'error', error: 'Missing plant parameter' }, { status: 400 });
        }
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        if (!startDate || !endDate) {
          return NextResponse.json({ status: 'error', error: 'Missing startDate or endDate parameter' }, { status: 400 });
        }

        const metrics = await apriso.getProductionMetrics({
          plant,
          line: searchParams.get('line') || undefined,
          shift: searchParams.get('shift') || undefined,
          dateRange: {
            start: new Date(startDate),
            end: new Date(endDate),
          },
        });
        return NextResponse.json({ status: 'ok', data: metrics });
      }

      default:
        return NextResponse.json(
          { status: 'error', error: `Unknown resource: ${resource}` },
          { status: 400 }
        );
    }
  } catch (err) {
    return NextResponse.json(
      { status: 'error', error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — Execute actions in Apriso
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    await enterprise.initialize();
    
    const apriso = enterprise.apriso;
    if (!apriso) {
      return NextResponse.json(
        { status: 'error', error: 'Apriso connector not configured' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const action = body.action as string;

    switch (action) {
      // ── Work Order Actions ────────────────────────────────────────────────
      case 'updateWorkOrderStatus': {
        const { workOrderId, status } = body as { workOrderId: string; status: WorkOrderStatus };
        if (!workOrderId || !status) {
          return NextResponse.json({ status: 'error', error: 'Missing workOrderId or status' }, { status: 400 });
        }
        await apriso.updateWorkOrderStatus(workOrderId, status);
        return NextResponse.json({ status: 'ok', message: 'Work order status updated' });
      }

      case 'releaseWorkOrder': {
        const { workOrderId } = body as { workOrderId: string };
        if (!workOrderId) {
          return NextResponse.json({ status: 'error', error: 'Missing workOrderId' }, { status: 400 });
        }
        await apriso.releaseWorkOrder(workOrderId);
        return NextResponse.json({ status: 'ok', message: 'Work order released' });
      }

      case 'completeWorkOrder': {
        const { workOrderId, quantityGood, quantityScrap } = body as {
          workOrderId: string;
          quantityGood?: number;
          quantityScrap?: number;
        };
        if (!workOrderId) {
          return NextResponse.json({ status: 'error', error: 'Missing workOrderId' }, { status: 400 });
        }
        await apriso.completeWorkOrder(workOrderId, { quantityGood, quantityScrap });
        return NextResponse.json({ status: 'ok', message: 'Work order completed' });
      }

      // ── Operation Actions ─────────────────────────────────────────────────
      case 'startOperation': {
        const { operationId, operatorId } = body as { operationId: string; operatorId: string };
        if (!operationId || !operatorId) {
          return NextResponse.json({ status: 'error', error: 'Missing operationId or operatorId' }, { status: 400 });
        }
        await apriso.startOperation(operationId, operatorId);
        return NextResponse.json({ status: 'ok', message: 'Operation started' });
      }

      case 'completeOperation': {
        const { operationId, result } = body as { operationId: string; result: OperationResult };
        if (!operationId || !result) {
          return NextResponse.json({ status: 'error', error: 'Missing operationId or result' }, { status: 400 });
        }
        await apriso.recordOperationResult(operationId, result);
        return NextResponse.json({ status: 'ok', message: 'Operation completed' });
      }

      case 'pauseOperation': {
        const { operationId, reason } = body as { operationId: string; reason?: string };
        if (!operationId) {
          return NextResponse.json({ status: 'error', error: 'Missing operationId' }, { status: 400 });
        }
        await apriso.pauseOperation(operationId, reason);
        return NextResponse.json({ status: 'ok', message: 'Operation paused' });
      }

      case 'resumeOperation': {
        const { operationId } = body as { operationId: string };
        if (!operationId) {
          return NextResponse.json({ status: 'error', error: 'Missing operationId' }, { status: 400 });
        }
        await apriso.resumeOperation(operationId);
        return NextResponse.json({ status: 'ok', message: 'Operation resumed' });
      }

      // ── Quality Actions ───────────────────────────────────────────────────
      case 'submitNCR': {
        const { ncr } = body as { ncr: NonConformanceReport };
        if (!ncr) {
          return NextResponse.json({ status: 'error', error: 'Missing ncr data' }, { status: 400 });
        }
        const ncrId = await apriso.submitNCR(ncr);
        return NextResponse.json({ status: 'ok', ncrId, message: 'NCR submitted' });
      }

      case 'createQualityHold': {
        const { hold } = body as { hold: Parameters<typeof apriso.createQualityHold>[0] };
        if (!hold) {
          return NextResponse.json({ status: 'error', error: 'Missing hold data' }, { status: 400 });
        }
        const holdId = await apriso.createQualityHold(hold);
        return NextResponse.json({ status: 'ok', holdId, message: 'Quality hold created' });
      }

      case 'releaseQualityHold': {
        const { holdId, releasedBy, notes } = body as { holdId: string; releasedBy: string; notes?: string };
        if (!holdId || !releasedBy) {
          return NextResponse.json({ status: 'error', error: 'Missing holdId or releasedBy' }, { status: 400 });
        }
        await apriso.releaseQualityHold(holdId, releasedBy, notes);
        return NextResponse.json({ status: 'ok', message: 'Quality hold released' });
      }

      // ── Material Actions ──────────────────────────────────────────────────
      case 'recordConsumption': {
        const { consumption } = body as { consumption: Parameters<typeof apriso.recordConsumption>[0] };
        if (!consumption) {
          return NextResponse.json({ status: 'error', error: 'Missing consumption data' }, { status: 400 });
        }
        await apriso.recordConsumption(consumption);
        return NextResponse.json({ status: 'ok', message: 'Consumption recorded' });
      }

      case 'recordScrap': {
        const { scrap } = body as { scrap: ScrapData };
        if (!scrap) {
          return NextResponse.json({ status: 'error', error: 'Missing scrap data' }, { status: 400 });
        }
        await apriso.recordScrap(scrap);
        return NextResponse.json({ status: 'ok', message: 'Scrap recorded' });
      }

      default:
        return NextResponse.json(
          { status: 'error', error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    return NextResponse.json(
      { status: 'error', error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
