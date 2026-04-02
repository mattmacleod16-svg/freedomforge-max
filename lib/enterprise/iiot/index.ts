/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — IIoT Protocol Module
   
   Industrial Internet of Things protocol integration
   ═══════════════════════════════════════════════════════════════════════════ */

export {
  // OPC-UA
  OPCUAClient,
  createOPCUAClient,
  type OPCUAServerConfig,
  type OPCUANode,
  type OPCUASubscription,
  
  // MQTT
  MQTTClient,
  createMQTTClient,
  type MQTTClientConfig,
  type MQTTMessage,
  type MQTTSubscription,
  
  // Sparkplug B
  SparkplugBClient,
  createSparkplugBClient,
  type SparkplugBConfig,
  type SparkplugBPayload,
  type SparkplugBMetric,
  type SparkplugBMessageType,
  
  // Unified Namespace
  UnifiedNamespaceManager,
  createUnifiedNamespace,
  type UNSNode,
  type UNSConfig,
  
  // Common Types
  type IIoTDevice,
  type IIoTDataPoint,
  type IIoTEvent,
} from './protocols';
