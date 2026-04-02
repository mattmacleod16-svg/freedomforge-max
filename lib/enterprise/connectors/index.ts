/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — Connectors Module Index
   
   Exports all enterprise system connectors
   ═══════════════════════════════════════════════════════════════════════════ */

// Apriso MES Connector
export {
  AprisoConnector,
  createAprisoConnector,
} from './apriso-connector';
export type { 
  AprisoFilters, 
  AprisoWorkCenter, 
  AprisoShift, 
  AprisoOperator, 
  AprisoProductionMetrics,
} from './apriso-connector';

// Oracle ERP Connector
export {
  OracleConnector,
  createOracleConnector,
} from './oracle-connector';
export type {
  OracleOrganization,
  OracleItemMaster,
  OracleWorkOrder,
  OracleOnHandQuantity,
  OraclePurchaseRequisition,
  OraclePurchaseRequisitionLine,
} from './oracle-connector';

// CMMS Connectors (IBM Maximo, ServiceNow)
export {
  MaximoConnector,
  ServiceNowConnector,
  AlarmToWorkOrderIntegration,
  createCMSSConnector,
} from './cmms-connector';
export type {
  CMSSConnector,
  CMSSConnectorConfig,
  CMSSAsset,
  CMSSLocation,
  CMSSWorkOrder,
  CMSSWorkOrderStatus,
  CMSSWorkOrderType,
  CMSSWorkOrderPriority,
  WorkOrderMaterial,
  PreventiveMaintenanceSchedule,
  ServiceRequest,
  MaximoConfig,
  ServiceNowConfig,
  AlarmWorkOrderConfig,
} from './cmms-connector';
