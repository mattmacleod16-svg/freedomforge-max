/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — Oracle Connector
   
   Integration with Oracle Cloud ERP, Manufacturing Cloud, and E-Business Suite
   Supports:
   - Inventory Management (on-hand, reservations, movements)
   - Purchase Requisitions (create, approve, track)
   - Production Scheduling (work orders, operations)
   - Analytics (Fusion Data Intelligence, BI reports)
   
   Connection Methods:
   - Oracle REST APIs (Oracle Cloud)
   - Oracle Integration Cloud (OIC) for hybrid
   - OData feeds for data queries
   - JDBC for legacy E-Business Suite (via proxy service)
   ═══════════════════════════════════════════════════════════════════════════ */

import { RestAdapter, createOAuth2Adapter } from '../adapters/rest-adapter';
import { ODataAdapter, ODataQueryOptions } from '../adapters/odata-adapter';
import type {
  OracleConfig,
  ConnectorHealth,
  InventoryItem,
  InventoryFilters,
  PurchaseRequisition,
  RequisitionStatus,
  ScheduleEntry,
  ProductionOrder,
  WorkOrderStatus,
  DateRange,
  OracleAnalyticsQuery,
  AnalyticsResult,
  PaginatedResponse,
} from '../types/enterprise-types';

// ─────────────────────────────────────────────────────────────────────────────
// Oracle-specific Types
// ─────────────────────────────────────────────────────────────────────────────

export interface OracleOrganization {
  organizationId: number;
  organizationCode: string;
  organizationName: string;
  type: 'manufacturing' | 'inventory' | 'distribution';
  legalEntity?: string;
  currency?: string;
  timezone?: string;
}

export interface OracleItemMaster {
  inventoryItemId: number;
  itemNumber: string;
  description: string;
  primaryUom: string;
  itemType: string;
  itemStatus: string;
  planningMakeOrBuy: 'make' | 'buy';
  purchasingEnabled: boolean;
  customerOrderEnabled: boolean;
  internalOrderEnabled: boolean;
  attributes?: Record<string, string>;
}

export interface OracleWorkOrder {
  workOrderId: number;
  workOrderNumber: string;
  workOrderType: string;
  status: string;
  itemNumber: string;
  itemDescription: string;
  organizationCode: string;
  plannedQuantity: number;
  completedQuantity: number;
  scrappedQuantity: number;
  plannedStartDate: string;
  plannedCompletionDate: string;
  actualStartDate?: string;
  actualCompletionDate?: string;
  priority?: number;
  routingSequenceId?: number;
}

export interface OracleOnHandQuantity {
  inventoryItemId: number;
  itemNumber: string;
  description: string;
  organizationId: number;
  organizationCode: string;
  subinventory?: string;
  locator?: string;
  lotNumber?: string;
  serialNumber?: string;
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  unitOfMeasure: string;
}

export interface OraclePurchaseRequisition {
  requisitionHeaderId: number;
  requisitionNumber: string;
  status: string;
  preparerName: string;
  creationDate: string;
  description?: string;
  totalAmount?: number;
  currency?: string;
  lines: OraclePurchaseRequisitionLine[];
}

export interface OraclePurchaseRequisitionLine {
  lineNumber: number;
  itemNumber?: string;
  itemDescription: string;
  quantity: number;
  unitPrice?: number;
  amount?: number;
  uom: string;
  needByDate: string;
  destinationOrganization?: string;
  suggestedVendorName?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Oracle API Response Types
// ─────────────────────────────────────────────────────────────────────────────

interface OracleApiResponse<T> {
  items?: T[];
  count?: number;
  hasMore?: boolean;
  limit?: number;
  offset?: number;
  links?: Array<{ rel: string; href: string }>;
}

interface OracleSingleResponse<T> {
  links?: Array<{ rel: string; href: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Oracle Connector Implementation
// ─────────────────────────────────────────────────────────────────────────────

export class OracleConnector {
  private rest: RestAdapter;
  private odata: ODataAdapter | null = null;
  private config: OracleConfig;
  private _health: ConnectorHealth = {
    status: 'disconnected',
    lastCheck: new Date(),
  };

  constructor(config: OracleConfig) {
    this.config = config;

    // Determine base URL (Cloud or ERP)
    const baseUrl = config.cloudUrl || config.erpUrl;
    if (!baseUrl) {
      throw new Error('Either cloudUrl or erpUrl must be provided');
    }

    // Initialize REST adapter with OAuth2
    this.rest = createOAuth2Adapter({
      baseUrl,
      tokenUrl: config.cloudUrl 
        ? `${config.cloudUrl}/oauth2/v1/token`
        : `${config.erpUrl}/fscmRestApi/tokenrelay`,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      scope: config.cloudUrl ? 'urn:opc:resource:consumer::all' : undefined,
      timeout: config.timeout ?? 60000,
    });

    // Initialize OData adapter for data queries
    if (config.cloudUrl) {
      this.odata = new ODataAdapter({
        baseUrl: `${config.cloudUrl}/fscmRestApi/resources/11.13.18.05`,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        tokenUrl: `${config.cloudUrl}/oauth2/v1/token`,
        timeout: config.timeout,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Connection & Health
  // ─────────────────────────────────────────────────────────────────────────────

  get health(): ConnectorHealth {
    return this._health;
  }

  async connect(): Promise<ConnectorHealth> {
    try {
      // Try a simple API call to verify connection
      await this.rest.get('/fscmRestApi/resources/11.13.18.05/inventoryOrganizations?limit=1');
      
      this._health = {
        status: 'connected',
        lastCheck: new Date(),
        version: 'Oracle Fusion Cloud',
      };
    } catch (err) {
      this._health = {
        status: 'error',
        lastCheck: new Date(),
        errorMessage: err instanceof Error ? err.message : 'Connection failed',
      };
    }

    return this._health;
  }

  async checkHealth(): Promise<ConnectorHealth> {
    return this.connect();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Organizations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get inventory organizations
   */
  async getOrganizations(): Promise<OracleOrganization[]> {
    const response = await this.rest.get<OracleApiResponse<{
      OrganizationId: number;
      OrganizationCode: string;
      OrganizationName: string;
      ManagementBusinessUnitName?: string;
    }>>('/fscmRestApi/resources/11.13.18.05/inventoryOrganizations');

    return (response.items ?? []).map(org => ({
      organizationId: org.OrganizationId,
      organizationCode: org.OrganizationCode,
      organizationName: org.OrganizationName,
      type: 'inventory' as const,
      legalEntity: org.ManagementBusinessUnitName,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Inventory Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get inventory levels for a plant/organization
   */
  async getInventoryLevels(filters: InventoryFilters): Promise<PaginatedResponse<InventoryItem>> {
    const params: Record<string, string | number | undefined> = {
      limit: filters.pageSize ?? 100,
      offset: filters.offset ?? ((filters.page ?? 1) - 1) * (filters.pageSize ?? 100),
    };

    // Build query filter
    const queryFilters: string[] = [];
    if (filters.plant) {
      queryFilters.push(`OrganizationCode='${filters.plant}'`);
    }
    if (filters.warehouse) {
      queryFilters.push(`Subinventory='${filters.warehouse}'`);
    }
    if (filters.search) {
      queryFilters.push(`upper(ItemNumber) like '*${filters.search.toUpperCase()}*'`);
    }

    if (queryFilters.length > 0) {
      params.q = queryFilters.join(';');
    }

    const response = await this.rest.get<OracleApiResponse<OracleOnHandQuantity>>(
      '/fscmRestApi/resources/11.13.18.05/inventoryBalances',
      params
    );

    const items = (response.items ?? []).map(this.mapInventoryItem);

    // Filter for below reorder point if requested
    let filteredItems = items;
    if (filters.belowReorderPoint) {
      filteredItems = items.filter(item => 
        item.reorderPoint !== undefined && 
        item.availableQuantity < item.reorderPoint
      );
    }

    return {
      items: filteredItems,
      total: response.count ?? filteredItems.length,
      page: filters.page ?? 1,
      pageSize: filters.pageSize ?? 100,
      hasMore: response.hasMore ?? false,
    };
  }

  /**
   * Get inventory item details
   */
  async getInventoryItem(itemNumber: string, organizationCode: string): Promise<InventoryItem | null> {
    const response = await this.rest.get<OracleApiResponse<OracleOnHandQuantity>>(
      '/fscmRestApi/resources/11.13.18.05/inventoryBalances',
      {
        q: `ItemNumber='${itemNumber}';OrganizationCode='${organizationCode}'`,
        limit: 1,
      }
    );

    if (!response.items?.length) {
      return null;
    }

    return this.mapInventoryItem(response.items[0]);
  }

  /**
   * Get item master data
   */
  async getItemMaster(itemNumber: string): Promise<OracleItemMaster | null> {
    const response = await this.rest.get<OracleApiResponse<{
      InventoryItemId: number;
      ItemNumber: string;
      Description: string;
      PrimaryUOMCode: string;
      ItemType: string;
      ItemStatus: string;
      PlanningMakeOrBuyCode: string;
      PurchasingEnabledFlag: boolean;
      CustomerOrderEnabledFlag: boolean;
      InternalOrderEnabledFlag: boolean;
    }>>('/fscmRestApi/resources/11.13.18.05/itemsV2', {
      q: `ItemNumber='${itemNumber}'`,
      limit: 1,
    });

    if (!response.items?.length) {
      return null;
    }

    const item = response.items[0];
    return {
      inventoryItemId: item.InventoryItemId,
      itemNumber: item.ItemNumber,
      description: item.Description,
      primaryUom: item.PrimaryUOMCode,
      itemType: item.ItemType,
      itemStatus: item.ItemStatus,
      planningMakeOrBuy: item.PlanningMakeOrBuyCode === 'Make' ? 'make' : 'buy',
      purchasingEnabled: item.PurchasingEnabledFlag,
      customerOrderEnabled: item.CustomerOrderEnabledFlag,
      internalOrderEnabled: item.InternalOrderEnabledFlag,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Purchase Requisitions
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a purchase requisition
   */
  async createPurchaseRequisition(pr: PurchaseRequisition): Promise<string> {
    const payload = {
      RequisitionHeaderId: null,
      Description: pr.justification,
      PreparedBy: pr.requestedBy,
      lines: pr.lines.map((line, index) => ({
        LineNumber: line.lineNumber || index + 1,
        ItemNumber: line.itemNumber,
        ItemDescription: line.description,
        Quantity: line.quantity,
        UOMCode: line.unitOfMeasure,
        UnitPrice: line.estimatedUnitCost,
        NeedByDate: line.needByDate.toISOString(),
        DestinationOrganizationCode: pr.plant,
        SuggestedVendorName: line.suggestedVendor,
        NoteToVendor: line.notes,
      })),
    };

    const response = await this.rest.post<{
      RequisitionHeaderId: number;
      RequisitionNumber: string;
      links?: Array<{ rel: string; href: string }>;
    }>('/fscmRestApi/resources/11.13.18.05/purchaseRequisitions', payload);

    return response.RequisitionNumber;
  }

  /**
   * Get purchase requisitions
   */
  async getPurchaseRequisitions(filters?: {
    status?: RequisitionStatus;
    preparerName?: string;
    dateRange?: DateRange;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResponse<{
    id: string;
    number: string;
    status: RequisitionStatus;
    preparer: string;
    createdAt: Date;
    description?: string;
    totalAmount?: number;
    lineCount: number;
  }>> {
    const params: Record<string, string | number | undefined> = {
      limit: filters?.pageSize ?? 50,
      offset: ((filters?.page ?? 1) - 1) * (filters?.pageSize ?? 50),
    };

    const queryFilters: string[] = [];
    if (filters?.status) {
      queryFilters.push(`Status='${this.mapRequisitionStatusToOracle(filters.status)}'`);
    }
    if (filters?.preparerName) {
      queryFilters.push(`PreparedBy='${filters.preparerName}'`);
    }
    if (filters?.dateRange?.start) {
      queryFilters.push(`CreationDate>='${filters.dateRange.start.toISOString()}'`);
    }
    if (filters?.dateRange?.end) {
      queryFilters.push(`CreationDate<='${filters.dateRange.end.toISOString()}'`);
    }

    if (queryFilters.length > 0) {
      params.q = queryFilters.join(';');
    }

    const response = await this.rest.get<OracleApiResponse<OraclePurchaseRequisition>>(
      '/fscmRestApi/resources/11.13.18.05/purchaseRequisitions',
      params
    );

    return {
      items: (response.items ?? []).map(pr => ({
        id: pr.requisitionHeaderId.toString(),
        number: pr.requisitionNumber,
        status: this.mapRequisitionStatusFromOracle(pr.status),
        preparer: pr.preparerName,
        createdAt: new Date(pr.creationDate),
        description: pr.description,
        totalAmount: pr.totalAmount,
        lineCount: pr.lines?.length ?? 0,
      })),
      total: response.count ?? 0,
      page: filters?.page ?? 1,
      pageSize: filters?.pageSize ?? 50,
      hasMore: response.hasMore ?? false,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Production Scheduling
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get production schedule
   */
  async getProductionSchedule(timeRange: DateRange, organizationCode?: string): Promise<ScheduleEntry[]> {
    const params: Record<string, string | number | undefined> = {
      limit: 500,
    };

    const queryFilters: string[] = [
      `PlannedStartDate>='${timeRange.start.toISOString()}'`,
      `PlannedStartDate<='${timeRange.end.toISOString()}'`,
    ];

    if (organizationCode) {
      queryFilters.push(`OrganizationCode='${organizationCode}'`);
    }

    params.q = queryFilters.join(';');

    const response = await this.rest.get<OracleApiResponse<OracleWorkOrder>>(
      '/fscmRestApi/resources/11.13.18.05/workOrders',
      params
    );

    return (response.items ?? []).map(wo => ({
      id: wo.workOrderId.toString(),
      workOrderId: wo.workOrderId.toString(),
      workOrderNumber: wo.workOrderNumber,
      partNumber: wo.itemNumber,
      partDescription: wo.itemDescription,
      quantity: wo.plannedQuantity,
      productionLine: wo.organizationCode,
      workCenter: wo.organizationCode,
      scheduledStart: new Date(wo.plannedStartDate),
      scheduledEnd: new Date(wo.plannedCompletionDate),
      priority: wo.priority ?? 5,
      status: this.mapWorkOrderStatusFromOracle(wo.status),
      percentComplete: wo.plannedQuantity > 0 
        ? Math.round((wo.completedQuantity / wo.plannedQuantity) * 100) 
        : 0,
    }));
  }

  /**
   * Get production orders
   */
  async getProductionOrders(filters?: {
    organizationCode?: string;
    status?: WorkOrderStatus;
    itemNumber?: string;
    dateRange?: DateRange;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResponse<ProductionOrder>> {
    const params: Record<string, string | number | undefined> = {
      limit: filters?.pageSize ?? 50,
      offset: ((filters?.page ?? 1) - 1) * (filters?.pageSize ?? 50),
    };

    const queryFilters: string[] = [];
    if (filters?.organizationCode) {
      queryFilters.push(`OrganizationCode='${filters.organizationCode}'`);
    }
    if (filters?.status) {
      queryFilters.push(`WorkOrderStatusCode='${this.mapWorkOrderStatusToOracle(filters.status)}'`);
    }
    if (filters?.itemNumber) {
      queryFilters.push(`ItemNumber='${filters.itemNumber}'`);
    }
    if (filters?.dateRange?.start) {
      queryFilters.push(`PlannedStartDate>='${filters.dateRange.start.toISOString()}'`);
    }
    if (filters?.dateRange?.end) {
      queryFilters.push(`PlannedStartDate<='${filters.dateRange.end.toISOString()}'`);
    }

    if (queryFilters.length > 0) {
      params.q = queryFilters.join(';');
    }

    const response = await this.rest.get<OracleApiResponse<OracleWorkOrder>>(
      '/fscmRestApi/resources/11.13.18.05/workOrders',
      params
    );

    return {
      items: (response.items ?? []).map(wo => ({
        id: wo.workOrderId.toString(),
        orderNumber: wo.workOrderNumber,
        itemNumber: wo.itemNumber,
        itemDescription: wo.itemDescription,
        quantity: wo.plannedQuantity,
        status: this.mapWorkOrderStatusFromOracle(wo.status),
        scheduledStartDate: new Date(wo.plannedStartDate),
        scheduledEndDate: new Date(wo.plannedCompletionDate),
        productionLine: wo.organizationCode,
        completionPercentage: wo.plannedQuantity > 0 
          ? Math.round((wo.completedQuantity / wo.plannedQuantity) * 100) 
          : 0,
        priority: wo.priority ?? 5,
      })),
      total: response.count ?? 0,
      page: filters?.page ?? 1,
      pageSize: filters?.pageSize ?? 50,
      hasMore: response.hasMore ?? false,
    };
  }

  /**
   * Update a production order
   */
  async updateProductionOrder(id: string, updates: Partial<ProductionOrder>): Promise<void> {
    const payload: Record<string, unknown> = {};

    if (updates.status) {
      payload.WorkOrderStatusCode = this.mapWorkOrderStatusToOracle(updates.status);
    }
    if (updates.scheduledStartDate) {
      payload.PlannedStartDate = updates.scheduledStartDate.toISOString();
    }
    if (updates.scheduledEndDate) {
      payload.PlannedCompletionDate = updates.scheduledEndDate.toISOString();
    }
    if (updates.priority !== undefined) {
      payload.Priority = updates.priority;
    }

    await this.rest.patch(`/fscmRestApi/resources/11.13.18.05/workOrders/${id}`, payload);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Analytics
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Run an analytics query (Oracle Fusion Data Intelligence)
   */
  async runAnalytics(query: OracleAnalyticsQuery): Promise<AnalyticsResult> {
    const start = Date.now();

    // Use OData for analytics queries
    if (this.odata && query.reportName) {
      const options: ODataQueryOptions = {
        $top: query.limit ?? 1000,
      };

      if (query.dimensions?.length) {
        options.$select = [...query.dimensions, ...(query.measures ?? [])];
      }

      if (query.filters) {
        const filterParts = Object.entries(query.filters).map(([field, value]) => {
          if (Array.isArray(value)) {
            return ODataAdapter.filter.in(field, value);
          }
          return ODataAdapter.filter.eq(field, value);
        });
        options.$filter = ODataAdapter.filter.and(...filterParts);
      }

      const result = await this.odata.query<Record<string, unknown>>(query.reportName, options);

      return {
        columns: this.inferColumns(result.items),
        rows: result.items,
        generatedAt: new Date(),
        executionTimeMs: Date.now() - start,
      };
    }

    // Fallback to REST API for report execution
    const response = await this.rest.post<{
      columns: Array<{ name: string; dataType: string; label: string }>;
      rows: Record<string, unknown>[];
    }>('/analyticsPublisher/api/v1/reports/execute', {
      reportPath: query.reportId ?? query.reportName,
      parameters: query.parameters,
      maxRows: query.limit ?? 1000,
    });

    return {
      columns: response.columns.map(col => ({
        name: col.name,
        type: this.mapOracleDataType(col.dataType),
        label: col.label,
      })),
      rows: response.rows,
      generatedAt: new Date(),
      executionTimeMs: Date.now() - start,
    };
  }

  /**
   * Get pre-built KPI metrics
   */
  async getKPIMetrics(metricType: 'inventory' | 'production' | 'procurement', organizationCode?: string): Promise<Record<string, number>> {
    const response = await this.rest.get<{
      metrics: Array<{ name: string; value: number; uom?: string }>;
    }>('/analyticsPublisher/api/v1/kpis', {
      type: metricType,
      organizationCode,
    });

    const metrics: Record<string, number> = {};
    for (const metric of response.metrics ?? []) {
      metrics[metric.name] = metric.value;
    }

    return metrics;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Mapping Functions
  // ─────────────────────────────────────────────────────────────────────────────

  private mapInventoryItem = (api: OracleOnHandQuantity): InventoryItem => ({
    id: api.inventoryItemId.toString(),
    itemNumber: api.itemNumber,
    description: api.description,
    category: 'General', // Would need additional API call for category
    unitOfMeasure: api.unitOfMeasure,
    onHandQuantity: api.onHandQuantity,
    reservedQuantity: api.reservedQuantity,
    availableQuantity: api.availableQuantity,
    plant: api.organizationCode,
    warehouse: api.subinventory,
    location: api.locator,
    lotControlled: !!api.lotNumber,
    serialControlled: !!api.serialNumber,
  });

  private mapWorkOrderStatusFromOracle(status: string): WorkOrderStatus {
    const map: Record<string, WorkOrderStatus> = {
      'ORA_UNRELEASED': 'created',
      'ORA_RELEASED': 'released',
      'ORA_ON_HOLD': 'on_hold',
      'ORA_COMPLETED': 'completed',
      'ORA_CLOSED': 'closed',
      'ORA_CANCELLED': 'cancelled',
      // Simpler status codes
      'UNRELEASED': 'created',
      'RELEASED': 'released',
      'ON_HOLD': 'on_hold',
      'COMPLETED': 'completed',
      'CLOSED': 'closed',
      'CANCELLED': 'cancelled',
    };
    return map[status] ?? 'created';
  }

  private mapWorkOrderStatusToOracle(status: WorkOrderStatus): string {
    const map: Record<WorkOrderStatus, string> = {
      'created': 'ORA_UNRELEASED',
      'released': 'ORA_RELEASED',
      'in_progress': 'ORA_RELEASED', // Oracle doesn't have in_progress
      'on_hold': 'ORA_ON_HOLD',
      'completed': 'ORA_COMPLETED',
      'closed': 'ORA_CLOSED',
      'cancelled': 'ORA_CANCELLED',
    };
    return map[status];
  }

  private mapRequisitionStatusFromOracle(status: string): RequisitionStatus {
    const map: Record<string, RequisitionStatus> = {
      'INCOMPLETE': 'draft',
      'PENDING_APPROVAL': 'submitted',
      'APPROVED': 'approved',
      'REJECTED': 'rejected',
      'ORDERED': 'ordered',
    };
    return map[status] ?? 'draft';
  }

  private mapRequisitionStatusToOracle(status: RequisitionStatus): string {
    const map: Record<RequisitionStatus, string> = {
      'draft': 'INCOMPLETE',
      'submitted': 'PENDING_APPROVAL',
      'approved': 'APPROVED',
      'rejected': 'REJECTED',
      'ordered': 'ORDERED',
    };
    return map[status];
  }

  private mapOracleDataType(dataType: string): 'string' | 'number' | 'date' | 'boolean' {
    const type = dataType.toUpperCase();
    if (type.includes('NUMBER') || type.includes('INTEGER') || type.includes('DECIMAL')) {
      return 'number';
    }
    if (type.includes('DATE') || type.includes('TIME')) {
      return 'date';
    }
    if (type.includes('BOOLEAN') || type.includes('FLAG')) {
      return 'boolean';
    }
    return 'string';
  }

  private inferColumns(rows: Record<string, unknown>[]): Array<{ name: string; type: 'string' | 'number' | 'date' | 'boolean'; label: string }> {
    if (!rows.length) return [];

    const firstRow = rows[0];
    return Object.entries(firstRow).map(([name, value]) => ({
      name,
      type: this.inferType(value),
      label: name.replace(/([A-Z])/g, ' $1').trim(),
    }));
  }

  private inferType(value: unknown): 'string' | 'number' | 'date' | 'boolean' {
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (value instanceof Date) return 'date';
    if (typeof value === 'string' && !isNaN(Date.parse(value))) return 'date';
    return 'string';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an Oracle connector from environment variables
 */
export function createOracleConnector(): OracleConnector | null {
  const cloudUrl = process.env.ORACLE_CLOUD_URL;
  const erpUrl = process.env.ORACLE_ERP_URL;
  const clientId = process.env.ORACLE_CLIENT_ID;
  const clientSecret = process.env.ORACLE_CLIENT_SECRET;

  if ((!cloudUrl && !erpUrl) || !clientId || !clientSecret) {
    return null;
  }

  return new OracleConnector({
    cloudUrl,
    erpUrl,
    clientId,
    clientSecret,
    tenantOcid: process.env.ORACLE_TENANT_OCID,
    compartmentOcid: process.env.ORACLE_COMPARTMENT_OCID,
    timeout: process.env.ORACLE_TIMEOUT ? parseInt(process.env.ORACLE_TIMEOUT, 10) : undefined,
  });
}
