/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — Type Definitions
   Shared types for PLM/MES integrations (Apriso, Oracle, Windchill, NextGenPLM)
   ═══════════════════════════════════════════════════════════════════════════ */

// ─────────────────────────────────────────────────────────────────────────────
// Common Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DateRange {
  start: Date;
  end: Date;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'connecting';

export interface ConnectorHealth {
  status: ConnectionStatus;
  lastCheck: Date;
  latencyMs?: number;
  errorMessage?: string;
  version?: string;
}

export interface AuditInfo {
  createdBy: string;
  createdAt: Date;
  modifiedBy?: string;
  modifiedAt?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Work Order Types (MES Common)
// ─────────────────────────────────────────────────────────────────────────────

export type WorkOrderStatus =
  | 'created'
  | 'released'
  | 'in_progress'
  | 'on_hold'
  | 'completed'
  | 'cancelled'
  | 'closed';

export type WorkOrderPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface WorkOrder {
  id: string;
  number: string;
  description: string;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  partNumber: string;
  partDescription?: string;
  quantity: number;
  quantityCompleted: number;
  quantityScrapped: number;
  plannedStartDate: Date;
  plannedEndDate: Date;
  actualStartDate?: Date;
  actualEndDate?: Date;
  productionLine?: string;
  workCenter?: string;
  routingId?: string;
  bomId?: string;
  customerId?: string;
  salesOrderId?: string;
  audit: AuditInfo;
}

export interface WorkOrderFilters extends PaginationParams {
  status?: WorkOrderStatus | WorkOrderStatus[];
  priority?: WorkOrderPriority | WorkOrderPriority[];
  partNumber?: string;
  productionLine?: string;
  workCenter?: string;
  dateRange?: DateRange;
  search?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Operation Types (Shop Floor)
// ─────────────────────────────────────────────────────────────────────────────

export type OperationStatus =
  | 'pending'
  | 'ready'
  | 'in_progress'
  | 'paused'
  | 'completed'
  | 'skipped';

export interface Operation {
  id: string;
  workOrderId: string;
  sequenceNumber: number;
  name: string;
  description?: string;
  status: OperationStatus;
  workCenter: string;
  machine?: string;
  operator?: string;
  plannedDurationMinutes: number;
  actualDurationMinutes?: number;
  setupTimeMinutes?: number;
  startTime?: Date;
  endTime?: Date;
  instructions?: string;
  tooling?: string[];
}

export interface OperationResult {
  operationId: string;
  status: OperationStatus;
  quantityGood: number;
  quantityScrap: number;
  actualDurationMinutes: number;
  operator: string;
  notes?: string;
  defectCodes?: string[];
  measurements?: OperationMeasurement[];
}

export interface OperationMeasurement {
  name: string;
  value: number;
  unit: string;
  lowerLimit?: number;
  upperLimit?: number;
  inSpec: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quality Management Types
// ─────────────────────────────────────────────────────────────────────────────

export type NCRSeverity = 'minor' | 'major' | 'critical';
export type NCRStatus = 'open' | 'under_review' | 'disposition_pending' | 'closed';
export type NCRDisposition = 'use_as_is' | 'rework' | 'repair' | 'scrap' | 'return_to_vendor';

export interface NonConformanceReport {
  id?: string;
  number?: string;
  title: string;
  description: string;
  severity: NCRSeverity;
  status?: NCRStatus;
  disposition?: NCRDisposition;
  partNumber: string;
  quantity: number;
  workOrderId?: string;
  operationId?: string;
  lotNumber?: string;
  serialNumbers?: string[];
  defectCodes: string[];
  rootCause?: string;
  correctiveAction?: string;
  preventiveAction?: string;
  reportedBy: string;
  reportedAt?: Date;
  audit?: AuditInfo;
}

export interface QualityHold {
  id: string;
  type: 'material' | 'work_order' | 'lot' | 'serial';
  referenceId: string;
  referenceNumber: string;
  reason: string;
  ncrId?: string;
  holdDate: Date;
  releasedDate?: Date;
  releasedBy?: string;
  status: 'active' | 'released';
}

export interface QualityFilters extends PaginationParams {
  status?: NCRStatus | NCRStatus[];
  severity?: NCRSeverity | NCRSeverity[];
  partNumber?: string;
  dateRange?: DateRange;
  disposition?: NCRDisposition;
}

// ─────────────────────────────────────────────────────────────────────────────
// Material Management Types
// ─────────────────────────────────────────────────────────────────────────────

export interface MaterialConsumption {
  id: string;
  workOrderId: string;
  operationId?: string;
  partNumber: string;
  partDescription: string;
  plannedQuantity: number;
  consumedQuantity: number;
  scrapQuantity: number;
  unitOfMeasure: string;
  lotNumber?: string;
  locationId?: string;
  consumedAt: Date;
  consumedBy: string;
}

export interface ScrapData {
  workOrderId: string;
  operationId?: string;
  partNumber: string;
  quantity: number;
  unitOfMeasure: string;
  scrapReasonCode: string;
  lotNumber?: string;
  serialNumbers?: string[];
  notes?: string;
  reportedBy: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inventory Types (Oracle ERP)
// ─────────────────────────────────────────────────────────────────────────────

export interface InventoryItem {
  id: string;
  itemNumber: string;
  description: string;
  category: string;
  subcategory?: string;
  unitOfMeasure: string;
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  reorderPoint?: number;
  safetyStock?: number;
  leadTimeDays?: number;
  standardCost?: number;
  averageCost?: number;
  plant: string;
  warehouse?: string;
  location?: string;
  lotControlled: boolean;
  serialControlled: boolean;
}

export interface InventoryFilters extends PaginationParams {
  plant: string;
  warehouse?: string;
  category?: string;
  search?: string;
  belowReorderPoint?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Purchase Requisition Types
// ─────────────────────────────────────────────────────────────────────────────

export type RequisitionStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'ordered';

export interface PurchaseRequisitionLine {
  lineNumber: number;
  itemNumber: string;
  description: string;
  quantity: number;
  unitOfMeasure: string;
  estimatedUnitCost?: number;
  needByDate: Date;
  deliverToLocation?: string;
  suggestedVendor?: string;
  notes?: string;
}

export interface PurchaseRequisition {
  id?: string;
  number?: string;
  status?: RequisitionStatus;
  requestedBy: string;
  department?: string;
  plant: string;
  lines: PurchaseRequisitionLine[];
  justification?: string;
  totalEstimatedCost?: number;
  urgency?: 'normal' | 'urgent';
}

// ─────────────────────────────────────────────────────────────────────────────
// Production Schedule Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ScheduleEntry {
  id: string;
  workOrderId: string;
  workOrderNumber: string;
  partNumber: string;
  partDescription: string;
  quantity: number;
  productionLine: string;
  workCenter?: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  priority: number;
  status: WorkOrderStatus;
  percentComplete: number;
  resourceUtilization?: number;
}

export interface ProductionOrder {
  id: string;
  orderNumber: string;
  itemNumber: string;
  itemDescription: string;
  quantity: number;
  status: WorkOrderStatus;
  scheduledStartDate: Date;
  scheduledEndDate: Date;
  productionLine: string;
  completionPercentage: number;
  priority: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics Types
// ─────────────────────────────────────────────────────────────────────────────

export interface OracleAnalyticsQuery {
  reportId?: string;
  reportName?: string;
  parameters?: Record<string, string | number | boolean | Date>;
  dateRange?: DateRange;
  dimensions?: string[];
  measures?: string[];
  filters?: Record<string, string | string[]>;
  limit?: number;
}

export interface AnalyticsResult {
  columns: AnalyticsColumn[];
  rows: Record<string, unknown>[];
  summary?: Record<string, number>;
  generatedAt: Date;
  executionTimeMs: number;
}

export interface AnalyticsColumn {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean';
  label: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PLM Types (for future Windchill/NextGenPLM)
// ─────────────────────────────────────────────────────────────────────────────

export interface BOMItem {
  id: string;
  parentId?: string;
  partNumber: string;
  revision: string;
  description: string;
  quantity: number;
  unitOfMeasure: string;
  level: number;
  findNumber?: string;
  referenceDesignators?: string[];
  substituteAllowed: boolean;
  substitutes?: string[];
  effectiveFrom?: Date;
  effectiveTo?: Date;
}

export interface BOMStructure {
  rootPartNumber: string;
  rootRevision: string;
  items: BOMItem[];
  levels: number;
  totalComponents: number;
  generatedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Enterprise SSO Types
// ─────────────────────────────────────────────────────────────────────────────

export type SSOProvider = 'azure-ad' | 'okta' | 'ping' | 'saml-generic';

export interface EnterpriseSSOConfig {
  provider: SSOProvider;
  enabled: boolean;
  clientId: string;
  clientSecret?: string;
  tenantId?: string;
  issuer?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  samlMetadataUrl?: string;
  redirectUri: string;
  scopes?: string[];
}

export interface EnterpriseUser {
  id: string;
  email: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  department?: string;
  title?: string;
  employeeId?: string;
  groups?: string[];
  roles: EnterpriseRole[];
  ssoProvider: SSOProvider;
  lastLogin?: Date;
}

export type AccessLevel = 'none' | 'read' | 'write' | 'admin';

export interface EnterpriseRole {
  id: string;
  name: string;
  description?: string;
  permissions: EnterprisePermission[];
  systemAccess: {
    apriso?: AccessLevel;
    oracle?: AccessLevel;
    windchill?: AccessLevel;
    nextgenPlm?: AccessLevel;
  };
}

export type EnterprisePermission =
  | 'enterprise:read'
  | 'enterprise:write'
  | 'enterprise:admin'
  | 'workorders:read'
  | 'workorders:write'
  | 'quality:read'
  | 'quality:write'
  | 'inventory:read'
  | 'inventory:write'
  | 'purchasing:read'
  | 'purchasing:write'
  | 'analytics:read'
  | 'analytics:export'
  | 'settings:read'
  | 'settings:write';

// ─────────────────────────────────────────────────────────────────────────────
// Sync Types
// ─────────────────────────────────────────────────────────────────────────────

export type SyncDirection = 'push' | 'pull' | 'bidirectional';
export type SyncStatus = 'idle' | 'syncing' | 'completed' | 'failed';
export type ConflictResolution = 'source_wins' | 'target_wins' | 'newest_wins' | 'manual';

export interface SyncConfig {
  id: string;
  name: string;
  sourceSystem: 'apriso' | 'oracle' | 'windchill' | 'nextgenplm' | 'freedomforge';
  targetSystem: 'apriso' | 'oracle' | 'windchill' | 'nextgenplm' | 'freedomforge';
  direction: SyncDirection;
  entityType: string;
  enabled: boolean;
  cronSchedule?: string;
  conflictResolution: ConflictResolution;
  fieldMappings: FieldMapping[];
  lastSyncAt?: Date;
  lastSyncStatus?: SyncStatus;
}

export interface FieldMapping {
  sourceField: string;
  targetField: string;
  transform?: 'uppercase' | 'lowercase' | 'trim' | 'date_iso' | 'custom';
  customTransform?: string;
  required: boolean;
}

export interface SyncResult {
  configId: string;
  startedAt: Date;
  completedAt?: Date;
  status: SyncStatus;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  recordsFailed: number;
  conflicts: SyncConflict[];
  errors: SyncError[];
}

export interface SyncConflict {
  recordId: string;
  entityType: string;
  sourceValue: unknown;
  targetValue: unknown;
  resolution?: ConflictResolution;
  resolvedAt?: Date;
  resolvedBy?: string;
}

export interface SyncError {
  recordId?: string;
  message: string;
  code?: string;
  timestamp: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Connector Configuration Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AprisoConfig {
  apiUrl: string;
  clientId: string;
  clientSecret: string;
  plant?: string;
  timeout?: number;
  retryAttempts?: number;
}

export interface OracleConfig {
  cloudUrl?: string;
  erpUrl?: string;
  clientId: string;
  clientSecret: string;
  tenantOcid?: string;
  compartmentOcid?: string;
  timeout?: number;
  retryAttempts?: number;
}

export interface WindchillConfig {
  url: string;
  username?: string;
  password?: string;
  oauthToken?: string;
  timeout?: number;
}

export interface NextGenPLMConfig {
  url: string;
  apiKey: string;
  timeout?: number;
}

export interface EnterpriseConfig {
  apriso?: AprisoConfig;
  oracle?: OracleConfig;
  windchill?: WindchillConfig;
  nextgenPlm?: NextGenPLMConfig;
  sso?: EnterpriseSSOConfig;
}
