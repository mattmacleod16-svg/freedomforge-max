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

// Types
export * from './types';

// Protocol Clients
export { BACnetClient, createBACnetClient, type BACnetClientConfig, type BACnetClientEvents } from './bacnet-client';
export { ModbusClient, ModbusConnectionPool, createModbusClient, type ModbusClientConfig, type ModbusClientEvents } from './modbus-client';

// Vendor Connectors
export { TracerConnector, createTracerConnector, type TracerConnectorConfig, type TracerConnectorEvents } from './tracer-connector';
