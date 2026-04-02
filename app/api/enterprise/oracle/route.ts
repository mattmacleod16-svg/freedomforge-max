/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — Oracle API
   
   REST API for Oracle Cloud ERP / Manufacturing Cloud integration
   Endpoints:
   - GET: Fetch inventory, purchase requisitions, production orders
   - POST: Create requisitions, update orders, run analytics
   ═══════════════════════════════════════════════════════════════════════════ */

import { NextResponse } from 'next/server';
import { enterprise } from '@/lib/enterprise';
import type { 
  PurchaseRequisition, 
  ProductionOrder, 
  OracleAnalyticsQuery,
  DateRange,
} from '@/lib/enterprise';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ─────────────────────────────────────────────────────────────────────────────
// GET — Fetch data from Oracle
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    await enterprise.initialize();
    
    const oracle = enterprise.oracle;
    if (!oracle) {
      return NextResponse.json(
        { status: 'error', error: 'Oracle connector not configured' },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(request.url);
    const resource = searchParams.get('resource') || 'inventory';

    switch (resource) {
      case 'organizations': {
        const organizations = await oracle.getOrganizations();
        return NextResponse.json({ status: 'ok', data: organizations });
      }

      case 'inventory': {
        const filters = {
          plant: searchParams.get('plant') || searchParams.get('organizationCode') || '',
          warehouse: searchParams.get('warehouse') || searchParams.get('subinventory') || undefined,
          category: searchParams.get('category') || undefined,
          search: searchParams.get('search') || undefined,
          belowReorderPoint: searchParams.get('belowReorderPoint') === 'true',
          page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : 1,
          pageSize: searchParams.get('pageSize') ? parseInt(searchParams.get('pageSize')!, 10) : 100,
        };

        if (!filters.plant) {
          return NextResponse.json(
            { status: 'error', error: 'Missing plant/organizationCode parameter' },
            { status: 400 }
          );
        }

        const inventory = await oracle.getInventoryLevels(filters);
        return NextResponse.json({ status: 'ok', ...inventory });
      }

      case 'inventoryItem': {
        const itemNumber = searchParams.get('itemNumber');
        const organizationCode = searchParams.get('organizationCode') || searchParams.get('plant');
        
        if (!itemNumber || !organizationCode) {
          return NextResponse.json(
            { status: 'error', error: 'Missing itemNumber or organizationCode' },
            { status: 400 }
          );
        }

        const item = await oracle.getInventoryItem(itemNumber, organizationCode);
        if (!item) {
          return NextResponse.json({ status: 'error', error: 'Item not found' }, { status: 404 });
        }
        return NextResponse.json({ status: 'ok', data: item });
      }

      case 'itemMaster': {
        const itemNumber = searchParams.get('itemNumber');
        if (!itemNumber) {
          return NextResponse.json({ status: 'error', error: 'Missing itemNumber' }, { status: 400 });
        }

        const item = await oracle.getItemMaster(itemNumber);
        if (!item) {
          return NextResponse.json({ status: 'error', error: 'Item not found' }, { status: 404 });
        }
        return NextResponse.json({ status: 'ok', data: item });
      }

      case 'requisitions': {
        const filters: {
          status?: 'draft' | 'submitted' | 'approved' | 'rejected' | 'ordered';
          preparerName?: string;
          dateRange?: DateRange;
          page?: number;
          pageSize?: number;
        } = {
          status: searchParams.get('status') as 'draft' | 'submitted' | 'approved' | 'rejected' | 'ordered' | undefined,
          preparerName: searchParams.get('preparerName') || undefined,
          page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : 1,
          pageSize: searchParams.get('pageSize') ? parseInt(searchParams.get('pageSize')!, 10) : 50,
        };

        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        if (startDate && endDate) {
          filters.dateRange = {
            start: new Date(startDate),
            end: new Date(endDate),
          };
        }

        const requisitions = await oracle.getPurchaseRequisitions(filters);
        return NextResponse.json({ status: 'ok', ...requisitions });
      }

      case 'schedule': {
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        
        if (!startDate || !endDate) {
          return NextResponse.json(
            { status: 'error', error: 'Missing startDate or endDate' },
            { status: 400 }
          );
        }

        const organizationCode = searchParams.get('organizationCode') || undefined;
        const schedule = await oracle.getProductionSchedule(
          { start: new Date(startDate), end: new Date(endDate) },
          organizationCode
        );
        return NextResponse.json({ status: 'ok', data: schedule });
      }

      case 'productionOrders': {
        const filters: {
          organizationCode?: string;
          status?: 'created' | 'released' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled' | 'closed';
          itemNumber?: string;
          dateRange?: DateRange;
          page?: number;
          pageSize?: number;
        } = {
          organizationCode: searchParams.get('organizationCode') || undefined,
          status: searchParams.get('status') as 'created' | 'released' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled' | 'closed' | undefined,
          itemNumber: searchParams.get('itemNumber') || undefined,
          page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : 1,
          pageSize: searchParams.get('pageSize') ? parseInt(searchParams.get('pageSize')!, 10) : 50,
        };

        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        if (startDate && endDate) {
          filters.dateRange = {
            start: new Date(startDate),
            end: new Date(endDate),
          };
        }

        const orders = await oracle.getProductionOrders(filters);
        return NextResponse.json({ status: 'ok', ...orders });
      }

      case 'kpis': {
        const metricType = (searchParams.get('metricType') || 'production') as 'inventory' | 'production' | 'procurement';
        const organizationCode = searchParams.get('organizationCode') || undefined;
        
        const metrics = await oracle.getKPIMetrics(metricType, organizationCode);
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
// POST — Execute actions in Oracle
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    await enterprise.initialize();
    
    const oracle = enterprise.oracle;
    if (!oracle) {
      return NextResponse.json(
        { status: 'error', error: 'Oracle connector not configured' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const action = body.action as string;

    switch (action) {
      // ── Purchase Requisition Actions ──────────────────────────────────────
      case 'createRequisition': {
        const { requisition } = body as { requisition: PurchaseRequisition };
        if (!requisition) {
          return NextResponse.json({ status: 'error', error: 'Missing requisition data' }, { status: 400 });
        }

        // Convert date strings to Date objects for lines
        if (requisition.lines) {
          requisition.lines = requisition.lines.map(line => ({
            ...line,
            needByDate: new Date(line.needByDate),
          }));
        }

        const requisitionNumber = await oracle.createPurchaseRequisition(requisition);
        return NextResponse.json({ 
          status: 'ok', 
          requisitionNumber, 
          message: 'Purchase requisition created' 
        });
      }

      // ── Production Order Actions ──────────────────────────────────────────
      case 'updateProductionOrder': {
        const { orderId, updates } = body as { orderId: string; updates: Partial<ProductionOrder> };
        if (!orderId) {
          return NextResponse.json({ status: 'error', error: 'Missing orderId' }, { status: 400 });
        }

        // Convert date strings to Date objects
        if (updates.scheduledStartDate && typeof updates.scheduledStartDate === 'string') {
          updates.scheduledStartDate = new Date(updates.scheduledStartDate);
        }
        if (updates.scheduledEndDate && typeof updates.scheduledEndDate === 'string') {
          updates.scheduledEndDate = new Date(updates.scheduledEndDate);
        }

        await oracle.updateProductionOrder(orderId, updates);
        return NextResponse.json({ status: 'ok', message: 'Production order updated' });
      }

      // ── Analytics Actions ─────────────────────────────────────────────────
      case 'runAnalytics': {
        const { query } = body as { query: OracleAnalyticsQuery };
        if (!query) {
          return NextResponse.json({ status: 'error', error: 'Missing query' }, { status: 400 });
        }

        // Convert date strings in dateRange
        if (query.dateRange) {
          query.dateRange = {
            start: new Date(query.dateRange.start),
            end: new Date(query.dateRange.end),
          };
        }

        const result = await oracle.runAnalytics(query);
        return NextResponse.json({ status: 'ok', data: result });
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
