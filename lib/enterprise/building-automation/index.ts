/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — Building Automation Module
   
   Enterprise-grade building automation integration layer
   Designed for Trane Technologies and other BAS vendor connectivity
   
   Supports:
   - BACnet/IP, BACnet/SC, BACnet MS/TP
   - Modbus TCP/IP, Modbus RTU
   - Trane Tracer SC/SC+ controllers
   - Multi-site building management
   ═══════════════════════════════════════════════════════════════════════════ */

// Types - selectively export to avoid collisions with enterprise-types
export type {
  // BACnet Types
  BACnetDevice,
  BACnetObject,
  BACnetObjectId,
  BACnetAddress,
  BACnetStatusFlags,
  BACnetSCConfig,
  BACnetSegmentation,
  BACnetServicesSupported,
  BuildingAutomationConfig,
  
  // HVAC Equipment Types
  HVACEquipment,
  HVACPoint,
  EquipmentStatus,
  EquipmentAlarm,
  EquipmentLocation,
  
  // Site/Building/Zone Types
  Site,
  Building,
  Zone,
  ZoneSetpoints,
  
  // Energy Types
  EnergyMeter,
  EnergyData,
  
  // Trane Tracer Types
  TracerController,
  TracerProtocol,
  TracerConfiguration,
  
  // Modbus Types
  ModbusDevice,
  ModbusRegister,
  ModbusDataType,
  ModbusRegisterType,
  ModbusReadResult,
  
  // Fault Detection Types
  FaultRule,
  FaultEvent,
  
  // Compliance Types
  ComplianceFramework,
  ComplianceRequirement,
  ComplianceReport,
  
  // Schedule Types (BAS-specific)
  WeeklySchedule as BASWeeklySchedule,
  ScheduleConfig,
} from './types';

// Export enums as values (not types)
export {
  BACnetObjectType,
  BACnetPropertyId,
  BACnetEngineeringUnits,
  HVACEquipmentType,
  HVACPointType,
} from './types';

// Protocol Clients
export { BACnetClient, createBACnetClient, type BACnetClientConfig, type BACnetClientEvents } from './bacnet-client';
export { ModbusClient, ModbusConnectionPool, createModbusClient, type ModbusClientConfig, type ModbusClientEvents } from './modbus-client';

// Vendor Connectors
export { TracerConnector, createTracerConnector, type TracerConnectorConfig, type TracerConnectorEvents } from './tracer-connector';
