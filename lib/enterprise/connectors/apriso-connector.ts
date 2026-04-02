/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — Apriso (DELMIA) Connector
   
   Integration with Dassault Systèmes DELMIA Apriso MES
   Supports:
   - Production Management (Work Orders, Operations)
   - Shop Floor Control (Operation execution, labor tracking)
   - Quality Management (NCRs, holds, inspections)
   - Material Management (consumption, scrap, inventory)
   
   Connection Methods:
   - DELMIA Apriso MES Web Services (REST/SOAP)
   - FlexNet MES APIs
   - OPC-UA for real-time equipment data
   ═══════════════════════════════════════════════════════════════════════════ */

import { RestAdapter, createOAuth2Adapter } from '../adapters/rest-adapter';
import { SoapAdapter } from '../adapters/soap-adapter';
import type {
  AprisoConfig,
  ConnectorHealth,
  WorkOrder,
  WorkOrderStatus,
  WorkOrderFilters,
  Operation,
  OperationStatus,
  OperationResult,
  NonConformanceReport,
  QualityHold,
  QualityFilters,
  MaterialConsumption,
  ScrapData,
  PaginatedResponse,
  DateRange,
} from '../types/enterprise-types';

// ─────────────────────────────────────────────────────────────────────────────
// Apriso-specific Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AprisoFilters extends WorkOrderFilters {
  plant?: string;
  line?: string;
  shift?: string;
  operatorId?: string;
}

export interface AprisoWorkCenter {
  id: string;
  name: string;
  description?: string;
  plant: string;
  line?: string;
  capacity?: number;
  status: 'active' | 'inactive' | 'maintenance';
}

export interface AprisoShift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  days: number[];
}

export interface AprisoOperator {
  id: string;
  employeeId: string;
  name: string;
  certifications?: string[];
  workCenters?: string[];
  shift?: string;
}

export interface AprisoProductionMetrics {
  plant: string;
  line?: string;
  shift?: string;
  date: Date;
  targetQuantity: number;
  actualQuantity: number;
  scrapQuantity: number;
  efficiency: number;
  oee?: number;
  downtimeMinutes?: number;
}

// OEE-related types (based on DSI Innovations / Ignition SCADA patterns)
export interface AprisoOEEData {
  equipmentId: string;
  equipmentName: string;
  period: DateRange;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  plannedTimeMinutes: number;
  operatingTimeMinutes: number;
  downtimeMinutes: number;
  idealCycleTimeSeconds: number;
  totalProduced: number;
  goodUnits: number;
  defectUnits: number;
}

export interface AprisoDowntimeEvent {
  id: string;
  equipmentId: string;
  startTime: Date;
  endTime?: Date;
  durationMinutes: number;
  reasonCode: string;
  reasonDescription?: string;
  isPlanned: boolean;
  notes?: string;
  recordedBy?: string;
}

export interface AprisoEquipmentState {
  equipmentId: string;
  equipmentName: string;
  state: 'running' | 'idle' | 'setup' | 'faulted' | 'maintenance' | 'offline';
  stateChangedAt: Date;
  currentWorkOrder?: string;
  currentOperator?: string;
  cycleCount?: number;
  lastCycleTimeSeconds?: number;
}

// API response types for OEE
interface AprisoApiOEEData {
  EquipmentId: string;
  EquipmentName: string;
  StartDate: string;
  EndDate: string;
  OEE: number;
  Availability: number;
  Performance: number;
  Quality: number;
  PlannedTimeMinutes: number;
  OperatingTimeMinutes: number;
  DowntimeMinutes: number;
  IdealCycleTimeSeconds: number;
  TotalProduced: number;
  GoodUnits: number;
  DefectUnits: number;
}

interface AprisoApiDowntimeEvent {
  EventId: string;
  EquipmentId: string;
  StartTime: string;
  EndTime?: string;
  DurationMinutes: number;
  ReasonCode: string;
  ReasonDescription?: string;
  IsPlanned: boolean;
  Notes?: string;
  RecordedBy?: string;
}

interface AprisoApiEquipmentState {
  EquipmentId: string;
  EquipmentName: string;
  State: string;
  StateChangedAt: string;
  CurrentWorkOrder?: string;
  CurrentOperator?: string;
  CycleCount?: number;
  LastCycleTimeSeconds?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Apriso API Response Types
// ─────────────────────────────────────────────────────────────────────────────

interface AprisoApiWorkOrder {
  WorkOrderId: string;
  WorkOrderNumber: string;
  Description: string;
  Status: string;
  Priority: string;
  ItemNumber: string;
  ItemDescription?: string;
  Quantity: number;
  QuantityCompleted: number;
  QuantityScrapped: number;
  PlannedStartDate: string;
  PlannedEndDate: string;
  ActualStartDate?: string;
  ActualEndDate?: string;
  ProductionLine?: string;
  WorkCenter?: string;
  RoutingId?: string;
  BOMId?: string;
  CustomerId?: string;
  SalesOrderId?: string;
  CreatedBy: string;
  CreatedDate: string;
  ModifiedBy?: string;
  ModifiedDate?: string;
}

interface AprisoApiOperation {
  OperationId: string;
  WorkOrderId: string;
  SequenceNumber: number;
  OperationName: string;
  Description?: string;
  Status: string;
  WorkCenter: string;
  Machine?: string;
  Operator?: string;
  PlannedDuration: number;
  ActualDuration?: number;
  SetupTime?: number;
  StartTime?: string;
  EndTime?: string;
  Instructions?: string;
  Tooling?: string;
}

interface AprisoApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  totalCount?: number;
  pageNumber?: number;
  pageSize?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Apriso Connector Implementation
// ─────────────────────────────────────────────────────────────────────────────

export class AprisoConnector {
  private rest: RestAdapter;
  private soap: SoapAdapter | null = null;
  private config: AprisoConfig;
  private _health: ConnectorHealth = {
    status: 'disconnected',
    lastCheck: new Date(),
  };

  constructor(config: AprisoConfig) {
    this.config = config;

    // Initialize REST adapter with OAuth2
    this.rest = createOAuth2Adapter({
      baseUrl: config.apiUrl,
      tokenUrl: `${config.apiUrl}/oauth/token`,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      timeout: config.timeout ?? 30000,
    });
  }

  /**
   * Initialize SOAP adapter for legacy operations
   */
  initializeSoap(wsdlUrl: string): void {
    this.soap = new SoapAdapter({
      endpointUrl: this.config.apiUrl.replace('/api', '/services'),
      wsdlUrl,
      username: this.config.clientId,
      password: this.config.clientSecret,
      timeout: this.config.timeout,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Connection & Health
  // ─────────────────────────────────────────────────────────────────────────────

  get health(): ConnectorHealth {
    return this._health;
  }

  async connect(): Promise<ConnectorHealth> {
    this._health = await this.rest.healthCheck('/api/v1/health');
    return this._health;
  }

  async checkHealth(): Promise<ConnectorHealth> {
    return this.connect();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Work Order Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get work orders with optional filters
   */
  async getWorkOrders(filters?: AprisoFilters): Promise<PaginatedResponse<WorkOrder>> {
    const params: Record<string, string | number | undefined> = {
      page: filters?.page ?? 1,
      pageSize: filters?.pageSize ?? 50,
      plant: filters?.plant ?? this.config.plant,
    };

    if (filters?.status) {
      params.status = Array.isArray(filters.status) 
        ? filters.status.join(',') 
        : filters.status;
    }
    if (filters?.priority) {
      params.priority = Array.isArray(filters.priority)
        ? filters.priority.join(',')
        : filters.priority;
    }
    if (filters?.partNumber) params.itemNumber = filters.partNumber;
    if (filters?.productionLine) params.productionLine = filters.productionLine;
    if (filters?.workCenter) params.workCenter = filters.workCenter;
    if (filters?.search) params.search = filters.search;
    if (filters?.dateRange?.start) params.startDate = filters.dateRange.start.toISOString();
    if (filters?.dateRange?.end) params.endDate = filters.dateRange.end.toISOString();

    const response = await this.rest.get<AprisoApiResponse<AprisoApiWorkOrder[]>>(
      '/api/v1/workorders',
      params
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to fetch work orders');
    }

    return {
      items: response.data.map(this.mapWorkOrder),
      total: response.totalCount ?? response.data.length,
      page: response.pageNumber ?? 1,
      pageSize: response.pageSize ?? 50,
      hasMore: (response.pageNumber ?? 1) * (response.pageSize ?? 50) < (response.totalCount ?? 0),
    };
  }

  /**
   * Get a single work order by ID
   */
  async getWorkOrder(id: string): Promise<WorkOrder> {
    const response = await this.rest.get<AprisoApiResponse<AprisoApiWorkOrder>>(
      `/api/v1/workorders/${id}`
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Work order not found');
    }

    return this.mapWorkOrder(response.data);
  }

  /**
   * Update work order status
   */
  async updateWorkOrderStatus(id: string, status: WorkOrderStatus): Promise<void> {
    const aprisoStatus = this.mapStatusToApriso(status);
    
    const response = await this.rest.patch<AprisoApiResponse<void>>(
      `/api/v1/workorders/${id}/status`,
      { status: aprisoStatus }
    );

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to update work order status');
    }
  }

  /**
   * Release a work order for production
   */
  async releaseWorkOrder(id: string): Promise<void> {
    return this.updateWorkOrderStatus(id, 'released');
  }

  /**
   * Complete a work order
   */
  async completeWorkOrder(id: string, data?: { quantityGood?: number; quantityScrap?: number }): Promise<void> {
    const response = await this.rest.post<AprisoApiResponse<void>>(
      `/api/v1/workorders/${id}/complete`,
      data
    );

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to complete work order');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Shop Floor Control
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get operations for a work order
   */
  async getOperations(workOrderId?: string): Promise<Operation[]> {
    const path = workOrderId 
      ? `/api/v1/workorders/${workOrderId}/operations`
      : '/api/v1/operations';

    const response = await this.rest.get<AprisoApiResponse<AprisoApiOperation[]>>(path);

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to fetch operations');
    }

    return response.data.map(this.mapOperation);
  }

  /**
   * Start an operation
   */
  async startOperation(operationId: string, operatorId: string): Promise<void> {
    const response = await this.rest.post<AprisoApiResponse<void>>(
      `/api/v1/operations/${operationId}/start`,
      { operatorId }
    );

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to start operation');
    }
  }

  /**
   * Complete an operation with results
   */
  async recordOperationResult(operationId: string, data: OperationResult): Promise<void> {
    const response = await this.rest.post<AprisoApiResponse<void>>(
      `/api/v1/operations/${operationId}/complete`,
      {
        status: data.status,
        quantityGood: data.quantityGood,
        quantityScrap: data.quantityScrap,
        actualDuration: data.actualDurationMinutes,
        operator: data.operator,
        notes: data.notes,
        defectCodes: data.defectCodes,
        measurements: data.measurements?.map(m => ({
          name: m.name,
          value: m.value,
          unit: m.unit,
          lowerLimit: m.lowerLimit,
          upperLimit: m.upperLimit,
        })),
      }
    );

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to record operation result');
    }
  }

  /**
   * Pause an operation
   */
  async pauseOperation(operationId: string, reason?: string): Promise<void> {
    const response = await this.rest.post<AprisoApiResponse<void>>(
      `/api/v1/operations/${operationId}/pause`,
      { reason }
    );

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to pause operation');
    }
  }

  /**
   * Resume a paused operation
   */
  async resumeOperation(operationId: string): Promise<void> {
    const response = await this.rest.post<AprisoApiResponse<void>>(
      `/api/v1/operations/${operationId}/resume`
    );

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to resume operation');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Quality Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Submit a Non-Conformance Report
   */
  async submitNCR(ncr: NonConformanceReport): Promise<string> {
    const response = await this.rest.post<AprisoApiResponse<{ ncrId: string; ncrNumber: string }>>(
      '/api/v1/quality/ncr',
      {
        title: ncr.title,
        description: ncr.description,
        severity: ncr.severity,
        itemNumber: ncr.partNumber,
        quantity: ncr.quantity,
        workOrderId: ncr.workOrderId,
        operationId: ncr.operationId,
        lotNumber: ncr.lotNumber,
        serialNumbers: ncr.serialNumbers,
        defectCodes: ncr.defectCodes,
        reportedBy: ncr.reportedBy,
      }
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to submit NCR');
    }

    return response.data.ncrId;
  }

  /**
   * Get quality holds
   */
  async getQualityHolds(filters?: QualityFilters): Promise<PaginatedResponse<QualityHold>> {
    const params: Record<string, string | number | undefined> = {
      page: filters?.page ?? 1,
      pageSize: filters?.pageSize ?? 50,
    };

    if (filters?.status) {
      params.status = Array.isArray(filters.status) 
        ? filters.status.join(',') 
        : filters.status;
    }
    if (filters?.severity) {
      params.severity = Array.isArray(filters.severity)
        ? filters.severity.join(',')
        : filters.severity;
    }
    if (filters?.partNumber) params.itemNumber = filters.partNumber;
    if (filters?.dateRange?.start) params.startDate = filters.dateRange.start.toISOString();
    if (filters?.dateRange?.end) params.endDate = filters.dateRange.end.toISOString();

    const response = await this.rest.get<AprisoApiResponse<QualityHold[]>>(
      '/api/v1/quality/holds',
      params
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to fetch quality holds');
    }

    return {
      items: response.data,
      total: response.totalCount ?? response.data.length,
      page: response.pageNumber ?? 1,
      pageSize: response.pageSize ?? 50,
      hasMore: (response.pageNumber ?? 1) * (response.pageSize ?? 50) < (response.totalCount ?? 0),
    };
  }

  /**
   * Create a quality hold
   */
  async createQualityHold(hold: Omit<QualityHold, 'id' | 'holdDate' | 'status'>): Promise<string> {
    const response = await this.rest.post<AprisoApiResponse<{ holdId: string }>>(
      '/api/v1/quality/holds',
      hold
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to create quality hold');
    }

    return response.data.holdId;
  }

  /**
   * Release a quality hold
   */
  async releaseQualityHold(holdId: string, releasedBy: string, notes?: string): Promise<void> {
    const response = await this.rest.post<AprisoApiResponse<void>>(
      `/api/v1/quality/holds/${holdId}/release`,
      { releasedBy, notes }
    );

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to release quality hold');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Material Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get material consumption for a work order
   */
  async getMaterialConsumption(workOrderId: string): Promise<MaterialConsumption[]> {
    const response = await this.rest.get<AprisoApiResponse<MaterialConsumption[]>>(
      `/api/v1/workorders/${workOrderId}/materials`
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to fetch material consumption');
    }

    return response.data;
  }

  /**
   * Record material consumption
   */
  async recordConsumption(data: {
    workOrderId: string;
    operationId?: string;
    partNumber: string;
    quantity: number;
    unitOfMeasure: string;
    lotNumber?: string;
    locationId?: string;
    consumedBy: string;
  }): Promise<void> {
    const response = await this.rest.post<AprisoApiResponse<void>>(
      '/api/v1/materials/consume',
      data
    );

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to record material consumption');
    }
  }

  /**
   * Record scrap
   */
  async recordScrap(data: ScrapData): Promise<void> {
    const response = await this.rest.post<AprisoApiResponse<void>>(
      '/api/v1/materials/scrap',
      {
        workOrderId: data.workOrderId,
        operationId: data.operationId,
        itemNumber: data.partNumber,
        quantity: data.quantity,
        unitOfMeasure: data.unitOfMeasure,
        scrapReasonCode: data.scrapReasonCode,
        lotNumber: data.lotNumber,
        serialNumbers: data.serialNumbers,
        notes: data.notes,
        reportedBy: data.reportedBy,
      }
    );

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to record scrap');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Work Centers & Resources
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get work centers
   */
  async getWorkCenters(plant?: string): Promise<AprisoWorkCenter[]> {
    const response = await this.rest.get<AprisoApiResponse<AprisoWorkCenter[]>>(
      '/api/v1/workcenters',
      { plant: plant ?? this.config.plant }
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to fetch work centers');
    }

    return response.data;
  }

  /**
   * Get production metrics
   */
  async getProductionMetrics(params: {
    plant: string;
    line?: string;
    shift?: string;
    dateRange: DateRange;
  }): Promise<AprisoProductionMetrics[]> {
    const response = await this.rest.get<AprisoApiResponse<AprisoProductionMetrics[]>>(
      '/api/v1/metrics/production',
      {
        plant: params.plant,
        line: params.line,
        shift: params.shift,
        startDate: params.dateRange.start.toISOString(),
        endDate: params.dateRange.end.toISOString(),
      }
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to fetch production metrics');
    }

    return response.data;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // OEE (Overall Equipment Effectiveness) Methods
  // Based on DSI Innovations / Ignition SCADA / Sepasoft MES patterns
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get OEE data for equipment/line
   * OEE = Availability × Performance × Quality
   */
  async getOEEData(params: {
    equipmentId: string;
    dateRange: DateRange;
    shift?: string;
  }): Promise<AprisoOEEData> {
    const response = await this.rest.get<AprisoApiResponse<AprisoApiOEEData>>(
      '/api/v1/metrics/oee',
      {
        equipmentId: params.equipmentId,
        startDate: params.dateRange.start.toISOString(),
        endDate: params.dateRange.end.toISOString(),
        shift: params.shift,
      }
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to fetch OEE data');
    }

    return this.mapOEEData(response.data);
  }

  /**
   * Get downtime events for OEE calculation
   */
  async getDowntimeEvents(params: {
    equipmentId?: string;
    workCenter?: string;
    dateRange: DateRange;
  }): Promise<AprisoDowntimeEvent[]> {
    const response = await this.rest.get<AprisoApiResponse<AprisoApiDowntimeEvent[]>>(
      '/api/v1/downtime/events',
      {
        equipmentId: params.equipmentId,
        workCenter: params.workCenter,
        startDate: params.dateRange.start.toISOString(),
        endDate: params.dateRange.end.toISOString(),
      }
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to fetch downtime events');
    }

    return response.data.map(this.mapDowntimeEvent);
  }

  /**
   * Record a downtime event
   */
  async recordDowntimeEvent(event: {
    equipmentId: string;
    startTime: Date;
    endTime?: Date;
    reasonCode: string;
    isPlanned: boolean;
    notes?: string;
    recordedBy: string;
  }): Promise<string> {
    const response = await this.rest.post<AprisoApiResponse<{ eventId: string }>>(
      '/api/v1/downtime/events',
      {
        EquipmentId: event.equipmentId,
        StartTime: event.startTime.toISOString(),
        EndTime: event.endTime?.toISOString(),
        ReasonCode: event.reasonCode,
        IsPlanned: event.isPlanned,
        Notes: event.notes,
        RecordedBy: event.recordedBy,
      }
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to record downtime event');
    }

    return response.data.eventId;
  }

  /**
   * Get equipment/machine states (for real-time OEE)
   */
  async getEquipmentStates(workCenter?: string): Promise<AprisoEquipmentState[]> {
    const response = await this.rest.get<AprisoApiResponse<AprisoApiEquipmentState[]>>(
      '/api/v1/equipment/states',
      { workCenter }
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to fetch equipment states');
    }

    return response.data.map(this.mapEquipmentState);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Mapping Functions
  // ─────────────────────────────────────────────────────────────────────────────

  private mapWorkOrder = (api: AprisoApiWorkOrder): WorkOrder => ({
    id: api.WorkOrderId,
    number: api.WorkOrderNumber,
    description: api.Description,
    status: this.mapStatusFromApriso(api.Status),
    priority: this.mapPriorityFromApriso(api.Priority),
    partNumber: api.ItemNumber,
    partDescription: api.ItemDescription,
    quantity: api.Quantity,
    quantityCompleted: api.QuantityCompleted,
    quantityScrapped: api.QuantityScrapped,
    plannedStartDate: new Date(api.PlannedStartDate),
    plannedEndDate: new Date(api.PlannedEndDate),
    actualStartDate: api.ActualStartDate ? new Date(api.ActualStartDate) : undefined,
    actualEndDate: api.ActualEndDate ? new Date(api.ActualEndDate) : undefined,
    productionLine: api.ProductionLine,
    workCenter: api.WorkCenter,
    routingId: api.RoutingId,
    bomId: api.BOMId,
    customerId: api.CustomerId,
    salesOrderId: api.SalesOrderId,
    audit: {
      createdBy: api.CreatedBy,
      createdAt: new Date(api.CreatedDate),
      modifiedBy: api.ModifiedBy,
      modifiedAt: api.ModifiedDate ? new Date(api.ModifiedDate) : undefined,
    },
  });

  private mapOperation = (api: AprisoApiOperation): Operation => ({
    id: api.OperationId,
    workOrderId: api.WorkOrderId,
    sequenceNumber: api.SequenceNumber,
    name: api.OperationName,
    description: api.Description,
    status: this.mapOperationStatusFromApriso(api.Status),
    workCenter: api.WorkCenter,
    machine: api.Machine,
    operator: api.Operator,
    plannedDurationMinutes: api.PlannedDuration,
    actualDurationMinutes: api.ActualDuration,
    setupTimeMinutes: api.SetupTime,
    startTime: api.StartTime ? new Date(api.StartTime) : undefined,
    endTime: api.EndTime ? new Date(api.EndTime) : undefined,
    instructions: api.Instructions,
    tooling: api.Tooling ? api.Tooling.split(',').map(t => t.trim()) : undefined,
  });

  private mapStatusFromApriso(status: string): WorkOrderStatus {
    const map: Record<string, WorkOrderStatus> = {
      'NEW': 'created',
      'CREATED': 'created',
      'RELEASED': 'released',
      'IN_PROGRESS': 'in_progress',
      'ACTIVE': 'in_progress',
      'ON_HOLD': 'on_hold',
      'HOLD': 'on_hold',
      'COMPLETED': 'completed',
      'COMPLETE': 'completed',
      'CANCELLED': 'cancelled',
      'CANCELED': 'cancelled',
      'CLOSED': 'closed',
    };
    return map[status.toUpperCase()] ?? 'created';
  }

  private mapStatusToApriso(status: WorkOrderStatus): string {
    const map: Record<WorkOrderStatus, string> = {
      'created': 'NEW',
      'released': 'RELEASED',
      'in_progress': 'IN_PROGRESS',
      'on_hold': 'ON_HOLD',
      'completed': 'COMPLETED',
      'cancelled': 'CANCELLED',
      'closed': 'CLOSED',
    };
    return map[status];
  }

  private mapPriorityFromApriso(priority: string): 'low' | 'normal' | 'high' | 'urgent' {
    const map: Record<string, 'low' | 'normal' | 'high' | 'urgent'> = {
      'LOW': 'low',
      '1': 'low',
      'NORMAL': 'normal',
      'MEDIUM': 'normal',
      '2': 'normal',
      'HIGH': 'high',
      '3': 'high',
      'URGENT': 'urgent',
      'CRITICAL': 'urgent',
      '4': 'urgent',
    };
    return map[priority.toUpperCase()] ?? 'normal';
  }

  private mapOperationStatusFromApriso(status: string): OperationStatus {
    const map: Record<string, OperationStatus> = {
      'PENDING': 'pending',
      'NOT_STARTED': 'pending',
      'READY': 'ready',
      'AVAILABLE': 'ready',
      'IN_PROGRESS': 'in_progress',
      'ACTIVE': 'in_progress',
      'RUNNING': 'in_progress',
      'PAUSED': 'paused',
      'HOLD': 'paused',
      'COMPLETED': 'completed',
      'COMPLETE': 'completed',
      'DONE': 'completed',
      'SKIPPED': 'skipped',
      'BYPASSED': 'skipped',
    };
    return map[status.toUpperCase()] ?? 'pending';
  }

  // OEE Mapping Functions
  private mapOEEData = (api: AprisoApiOEEData): AprisoOEEData => ({
    equipmentId: api.EquipmentId,
    equipmentName: api.EquipmentName,
    period: {
      start: new Date(api.StartDate),
      end: new Date(api.EndDate),
    },
    oee: api.OEE,
    availability: api.Availability,
    performance: api.Performance,
    quality: api.Quality,
    plannedTimeMinutes: api.PlannedTimeMinutes,
    operatingTimeMinutes: api.OperatingTimeMinutes,
    downtimeMinutes: api.DowntimeMinutes,
    idealCycleTimeSeconds: api.IdealCycleTimeSeconds,
    totalProduced: api.TotalProduced,
    goodUnits: api.GoodUnits,
    defectUnits: api.DefectUnits,
  });

  private mapDowntimeEvent = (api: AprisoApiDowntimeEvent): AprisoDowntimeEvent => ({
    id: api.EventId,
    equipmentId: api.EquipmentId,
    startTime: new Date(api.StartTime),
    endTime: api.EndTime ? new Date(api.EndTime) : undefined,
    durationMinutes: api.DurationMinutes,
    reasonCode: api.ReasonCode,
    reasonDescription: api.ReasonDescription,
    isPlanned: api.IsPlanned,
    notes: api.Notes,
    recordedBy: api.RecordedBy,
  });

  private mapEquipmentState = (api: AprisoApiEquipmentState): AprisoEquipmentState => ({
    equipmentId: api.EquipmentId,
    equipmentName: api.EquipmentName,
    state: this.mapEquipmentStateFromApriso(api.State),
    stateChangedAt: new Date(api.StateChangedAt),
    currentWorkOrder: api.CurrentWorkOrder,
    currentOperator: api.CurrentOperator,
    cycleCount: api.CycleCount,
    lastCycleTimeSeconds: api.LastCycleTimeSeconds,
  });

  private mapEquipmentStateFromApriso(state: string): AprisoEquipmentState['state'] {
    const map: Record<string, AprisoEquipmentState['state']> = {
      'RUNNING': 'running',
      'RUN': 'running',
      'ACTIVE': 'running',
      'IDLE': 'idle',
      'STANDBY': 'idle',
      'SETUP': 'setup',
      'CHANGEOVER': 'setup',
      'FAULTED': 'faulted',
      'FAULT': 'faulted',
      'ALARM': 'faulted',
      'MAINTENANCE': 'maintenance',
      'PM': 'maintenance',
      'OFFLINE': 'offline',
      'DOWN': 'offline',
    };
    return map[state.toUpperCase()] ?? 'idle';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an Apriso connector from environment variables
 */
export function createAprisoConnector(): AprisoConnector | null {
  const apiUrl = process.env.APRISO_API_URL;
  const clientId = process.env.APRISO_CLIENT_ID;
  const clientSecret = process.env.APRISO_CLIENT_SECRET;

  if (!apiUrl || !clientId || !clientSecret) {
    return null;
  }

  return new AprisoConnector({
    apiUrl,
    clientId,
    clientSecret,
    plant: process.env.APRISO_PLANT,
    timeout: process.env.APRISO_TIMEOUT ? parseInt(process.env.APRISO_TIMEOUT, 10) : undefined,
  });
}
