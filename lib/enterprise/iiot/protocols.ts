/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — IIoT Protocol Layer
   
   Industrial Internet of Things protocol integration
   
   Supported Protocols:
   - OPC-UA (OPC Unified Architecture)
   - MQTT (Message Queuing Telemetry Transport)
   - Sparkplug B (MQTT payload specification for IIoT)
   
   Features:
   - Unified Namespace (UNS) architecture
   - Real-time data streaming
   - Device discovery and management
   - Secure connectivity (TLS, certificates)
   - Edge-to-cloud integration
   ═══════════════════════════════════════════════════════════════════════════ */

import { EventEmitter } from 'events';

// ─────────────────────────────────────────────────────────────────────────────
// Common IIoT Types
// ─────────────────────────────────────────────────────────────────────────────

export interface IIoTDevice {
  id: string;
  name: string;
  description?: string;
  type: 'plc' | 'sensor' | 'actuator' | 'gateway' | 'hmi' | 'robot' | 'cnc' | 'other';
  protocol: 'opcua' | 'mqtt' | 'modbus' | 'bacnet';
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  firmwareVersion?: string;
  location?: {
    site: string;
    area: string;
    line?: string;
    cell?: string;
  };
  status: 'online' | 'offline' | 'error' | 'maintenance';
  lastSeen?: Date;
  metadata?: Record<string, unknown>;
}

export interface IIoTDataPoint {
  id: string;
  deviceId: string;
  name: string;
  path: string; // UNS path (e.g., "site1/area2/line3/plc1/temperature")
  dataType: 'boolean' | 'int8' | 'int16' | 'int32' | 'int64' | 'float' | 'double' | 'string' | 'datetime' | 'array';
  value: unknown;
  timestamp: Date;
  quality: 'good' | 'bad' | 'uncertain';
  sourceTimestamp?: Date;
  serverTimestamp?: Date;
  engineeringUnits?: string;
  min?: number;
  max?: number;
  deadband?: number;
}

export interface IIoTEvent {
  id: string;
  source: string;
  type: 'alarm' | 'event' | 'condition' | 'audit';
  severity: number; // 1-1000
  message: string;
  timestamp: Date;
  acknowledged?: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  active: boolean;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// OPC-UA Types
// ─────────────────────────────────────────────────────────────────────────────

export interface OPCUAServerConfig {
  endpointUrl: string;
  securityMode: 'none' | 'sign' | 'signAndEncrypt';
  securityPolicy: 'none' | 'basic128Rsa15' | 'basic256' | 'basic256Sha256' | 'aes128Sha256RsaOaep' | 'aes256Sha256RsaPss';
  applicationName?: string;
  applicationUri?: string;
  productUri?: string;
  certificate?: string;
  privateKey?: string;
  username?: string;
  password?: string;
  requestedSessionTimeout?: number;
  connectionStrategy?: {
    maxRetry: number;
    initialDelay: number;
    maxDelay: number;
  };
}

export interface OPCUANode {
  nodeId: string;
  browseName: string;
  displayName: string;
  nodeClass: 'object' | 'variable' | 'method' | 'objectType' | 'variableType' | 'referenceType' | 'dataType' | 'view';
  dataType?: string;
  value?: unknown;
  accessLevel?: number;
  userAccessLevel?: number;
  historizing?: boolean;
  minimumSamplingInterval?: number;
  description?: string;
  children?: OPCUANode[];
}

export interface OPCUASubscription {
  subscriptionId: number;
  publishingInterval: number;
  lifetimeCount: number;
  maxKeepAliveCount: number;
  maxNotificationsPerPublish: number;
  publishingEnabled: boolean;
  priority: number;
  monitoredItems: {
    monitoredItemId: number;
    nodeId: string;
    samplingInterval: number;
    queueSize: number;
    discardOldest: boolean;
  }[];
}

/**
 * OPC-UA Client Implementation
 * Provides connectivity to OPC-UA servers for industrial equipment
 */
export class OPCUAClient extends EventEmitter {
  private config: OPCUAServerConfig;
  private connected = false;
  private sessionId?: string;
  private subscriptions: Map<number, OPCUASubscription> = new Map();
  private nodeCache: Map<string, OPCUANode> = new Map();

  constructor(config: OPCUAServerConfig) {
    super();
    this.config = {
      ...config,
      requestedSessionTimeout: config.requestedSessionTimeout || 60000,
      connectionStrategy: config.connectionStrategy || {
        maxRetry: 3,
        initialDelay: 1000,
        maxDelay: 30000,
      },
    };
  }

  /**
   * Connect to OPC-UA server
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    this.emit('connecting', { endpoint: this.config.endpointUrl });

    try {
      // In a real implementation, this would use node-opcua or similar library
      // For this implementation, we simulate the connection
      
      // Validate endpoint
      const url = new URL(this.config.endpointUrl);
      if (url.protocol !== 'opc.tcp:') {
        throw new Error('Invalid OPC-UA endpoint. Must use opc.tcp:// protocol');
      }

      // Simulate connection establishment
      this.sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.connected = true;
      
      this.emit('connected', { sessionId: this.sessionId });
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Disconnect from OPC-UA server
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;

    // Close all subscriptions
    for (const subId of this.subscriptions.keys()) {
      await this.deleteSubscription(subId);
    }

    this.connected = false;
    this.sessionId = undefined;
    this.emit('disconnected');
  }

  /**
   * Browse the OPC-UA address space
   */
  async browse(nodeId?: string): Promise<OPCUANode[]> {
    this.ensureConnected();

    const rootNodeId = nodeId || 'i=85'; // ObjectsFolder

    // In a real implementation, this would browse the actual server
    // Return simulated nodes for demonstration
    const nodes: OPCUANode[] = [
      {
        nodeId: 'ns=2;s=Server',
        browseName: 'Server',
        displayName: 'Server Information',
        nodeClass: 'object',
      },
      {
        nodeId: 'ns=2;s=DeviceSet',
        browseName: 'DeviceSet',
        displayName: 'Devices',
        nodeClass: 'object',
      },
    ];

    return nodes;
  }

  /**
   * Read a node value
   */
  async readNode(nodeId: string): Promise<{ value: unknown; sourceTimestamp: Date; serverTimestamp: Date; statusCode: number }> {
    this.ensureConnected();

    // Check cache first
    const cached = this.nodeCache.get(nodeId);
    
    // In a real implementation, this would read from the actual server
    return {
      value: cached?.value ?? Math.random() * 100,
      sourceTimestamp: new Date(),
      serverTimestamp: new Date(),
      statusCode: 0, // Good
    };
  }

  /**
   * Read multiple node values
   */
  async readNodes(nodeIds: string[]): Promise<Map<string, { value: unknown; statusCode: number }>> {
    this.ensureConnected();

    const results = new Map<string, { value: unknown; statusCode: number }>();
    
    for (const nodeId of nodeIds) {
      const result = await this.readNode(nodeId);
      results.set(nodeId, { value: result.value, statusCode: result.statusCode });
    }

    return results;
  }

  /**
   * Write a value to a node
   */
  async writeNode(nodeId: string, value: unknown, dataType?: string): Promise<number> {
    this.ensureConnected();

    // In a real implementation, this would write to the actual server
    // Update cache
    const node = this.nodeCache.get(nodeId);
    if (node) {
      node.value = value;
    }

    this.emit('valueWritten', { nodeId, value });
    return 0; // Good status code
  }

  /**
   * Create a subscription for data change notifications
   */
  async createSubscription(options: {
    publishingInterval?: number;
    lifetimeCount?: number;
    maxKeepAliveCount?: number;
    maxNotificationsPerPublish?: number;
    priority?: number;
  } = {}): Promise<number> {
    this.ensureConnected();

    const subscriptionId = Math.floor(Math.random() * 1000000);
    
    const subscription: OPCUASubscription = {
      subscriptionId,
      publishingInterval: options.publishingInterval || 1000,
      lifetimeCount: options.lifetimeCount || 1000,
      maxKeepAliveCount: options.maxKeepAliveCount || 100,
      maxNotificationsPerPublish: options.maxNotificationsPerPublish || 100,
      publishingEnabled: true,
      priority: options.priority || 0,
      monitoredItems: [],
    };

    this.subscriptions.set(subscriptionId, subscription);
    this.emit('subscriptionCreated', subscription);

    return subscriptionId;
  }

  /**
   * Add a monitored item to a subscription
   */
  async addMonitoredItem(
    subscriptionId: number,
    nodeId: string,
    options: {
      samplingInterval?: number;
      queueSize?: number;
      discardOldest?: boolean;
    } = {}
  ): Promise<number> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      throw new Error(`Subscription ${subscriptionId} not found`);
    }

    const monitoredItemId = Math.floor(Math.random() * 1000000);
    
    subscription.monitoredItems.push({
      monitoredItemId,
      nodeId,
      samplingInterval: options.samplingInterval || subscription.publishingInterval,
      queueSize: options.queueSize || 10,
      discardOldest: options.discardOldest ?? true,
    });

    // Start simulated data change notifications
    this.startMonitoredItemSimulation(subscriptionId, monitoredItemId, nodeId);

    return monitoredItemId;
  }

  private startMonitoredItemSimulation(subscriptionId: number, monitoredItemId: number, nodeId: string): void {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return;

    const item = subscription.monitoredItems.find(i => i.monitoredItemId === monitoredItemId);
    if (!item) return;

    // Simulate data changes
    const interval = setInterval(() => {
      if (!this.connected || !this.subscriptions.has(subscriptionId)) {
        clearInterval(interval);
        return;
      }

      const value = Math.random() * 100;
      this.emit('dataChange', {
        subscriptionId,
        monitoredItemId,
        nodeId,
        value,
        sourceTimestamp: new Date(),
        serverTimestamp: new Date(),
        statusCode: 0,
      });
    }, item.samplingInterval);
  }

  /**
   * Delete a subscription
   */
  async deleteSubscription(subscriptionId: number): Promise<void> {
    this.subscriptions.delete(subscriptionId);
    this.emit('subscriptionDeleted', { subscriptionId });
  }

  /**
   * Call a method on the server
   */
  async callMethod(
    objectId: string,
    methodId: string,
    inputArguments: unknown[]
  ): Promise<{ statusCode: number; outputArguments: unknown[] }> {
    this.ensureConnected();

    // In a real implementation, this would call the actual method
    this.emit('methodCalled', { objectId, methodId, inputArguments });

    return {
      statusCode: 0,
      outputArguments: [],
    };
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('Not connected to OPC-UA server');
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MQTT Types and Client
// ─────────────────────────────────────────────────────────────────────────────

export interface MQTTClientConfig {
  brokerUrl: string;
  clientId?: string;
  username?: string;
  password?: string;
  clean?: boolean;
  keepalive?: number;
  reconnectPeriod?: number;
  connectTimeout?: number;
  ca?: string;
  cert?: string;
  key?: string;
  rejectUnauthorized?: boolean;
  will?: {
    topic: string;
    payload: string | Buffer;
    qos: 0 | 1 | 2;
    retain: boolean;
  };
}

export interface MQTTMessage {
  topic: string;
  payload: Buffer | string;
  qos: 0 | 1 | 2;
  retain: boolean;
  dup: boolean;
  packetId?: number;
}

export interface MQTTSubscription {
  topic: string;
  qos: 0 | 1 | 2;
}

/**
 * MQTT Client Implementation
 * Provides connectivity to MQTT brokers for IIoT messaging
 */
export class MQTTClient extends EventEmitter {
  private config: MQTTClientConfig;
  private connected = false;
  private subscriptions: Map<string, MQTTSubscription> = new Map();
  private messageHandlers: Map<string, ((message: MQTTMessage) => void)[]> = new Map();

  constructor(config: MQTTClientConfig) {
    super();
    this.config = {
      ...config,
      clientId: config.clientId || `mqtt-client-${Date.now()}`,
      clean: config.clean ?? true,
      keepalive: config.keepalive || 60,
      reconnectPeriod: config.reconnectPeriod || 1000,
      connectTimeout: config.connectTimeout || 30000,
    };
  }

  /**
   * Connect to MQTT broker
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    this.emit('connecting', { broker: this.config.brokerUrl });

    try {
      // In a real implementation, this would use mqtt.js or similar library
      // Validate broker URL
      const url = new URL(this.config.brokerUrl);
      if (!['mqtt:', 'mqtts:', 'ws:', 'wss:'].includes(url.protocol)) {
        throw new Error('Invalid MQTT broker URL. Must use mqtt://, mqtts://, ws://, or wss://');
      }

      // Simulate connection
      this.connected = true;
      this.emit('connected', { clientId: this.config.clientId });

      // Re-subscribe to existing subscriptions
      for (const [topic, sub] of this.subscriptions) {
        await this.subscribe(topic, sub.qos);
      }
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Disconnect from MQTT broker
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;

    this.connected = false;
    this.emit('disconnected');
  }

  /**
   * Subscribe to a topic
   */
  async subscribe(topic: string, qos: 0 | 1 | 2 = 0): Promise<void> {
    this.ensureConnected();

    this.subscriptions.set(topic, { topic, qos });
    this.emit('subscribed', { topic, qos });
  }

  /**
   * Unsubscribe from a topic
   */
  async unsubscribe(topic: string): Promise<void> {
    this.ensureConnected();

    this.subscriptions.delete(topic);
    this.messageHandlers.delete(topic);
    this.emit('unsubscribed', { topic });
  }

  /**
   * Publish a message
   */
  async publish(
    topic: string,
    payload: string | Buffer | object,
    options: { qos?: 0 | 1 | 2; retain?: boolean } = {}
  ): Promise<void> {
    this.ensureConnected();

    const message: MQTTMessage = {
      topic,
      payload: typeof payload === 'object' && !Buffer.isBuffer(payload)
        ? JSON.stringify(payload)
        : payload,
      qos: options.qos || 0,
      retain: options.retain || false,
      dup: false,
    };

    this.emit('messagePublished', message);
  }

  /**
   * Register a message handler for a topic pattern
   */
  onMessage(topicPattern: string, handler: (message: MQTTMessage) => void): void {
    const handlers = this.messageHandlers.get(topicPattern) || [];
    handlers.push(handler);
    this.messageHandlers.set(topicPattern, handlers);
  }

  /**
   * Simulate receiving a message (for testing)
   */
  simulateMessage(topic: string, payload: string | Buffer): void {
    const message: MQTTMessage = {
      topic,
      payload,
      qos: 0,
      retain: false,
      dup: false,
    };

    // Find matching handlers
    for (const [pattern, handlers] of this.messageHandlers) {
      if (this.topicMatchesPattern(topic, pattern)) {
        for (const handler of handlers) {
          handler(message);
        }
      }
    }

    this.emit('message', message);
  }

  private topicMatchesPattern(topic: string, pattern: string): boolean {
    const topicParts = topic.split('/');
    const patternParts = pattern.split('/');

    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];
      const topicPart = topicParts[i];

      if (patternPart === '#') {
        return true; // Multi-level wildcard matches everything
      }

      if (patternPart === '+') {
        continue; // Single-level wildcard matches this level
      }

      if (patternPart !== topicPart) {
        return false;
      }
    }

    return topicParts.length === patternParts.length;
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('Not connected to MQTT broker');
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get activeSubscriptions(): MQTTSubscription[] {
    return Array.from(this.subscriptions.values());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sparkplug B Implementation
// ─────────────────────────────────────────────────────────────────────────────

export interface SparkplugBMetric {
  name: string;
  alias?: number;
  timestamp?: number;
  dataType: 'boolean' | 'uint8' | 'uint16' | 'uint32' | 'uint64' | 'int8' | 'int16' | 'int32' | 'int64' | 'float' | 'double' | 'string' | 'datetime' | 'bytes';
  value: unknown;
  isHistorical?: boolean;
  isTransient?: boolean;
  metadata?: {
    isMultiPart?: boolean;
    contentType?: string;
    size?: number;
    fileName?: string;
    fileType?: string;
    md5?: string;
    description?: string;
  };
  properties?: Record<string, {
    type: string;
    value: unknown;
  }>;
}

export interface SparkplugBPayload {
  timestamp: number;
  metrics: SparkplugBMetric[];
  seq?: number;
  uuid?: string;
  body?: Buffer;
  bdSeq?: number; // Birth/Death sequence number (for NBIRTH/NDEATH)
}

export type SparkplugBMessageType = 'NBIRTH' | 'NDEATH' | 'DBIRTH' | 'DDEATH' | 'NDATA' | 'DDATA' | 'NCMD' | 'DCMD' | 'STATE';

export interface SparkplugBConfig {
  groupId: string;
  edgeNodeId: string;
  clientId?: string;
  brokerUrl: string;
  username?: string;
  password?: string;
  bdSeq?: number;
  primaryHostId?: string;
  keepalive?: number;
  version?: 'B3.0' | 'B2.2';
}

/**
 * Sparkplug B Client Implementation
 * Provides IIoT-standard messaging over MQTT with Sparkplug B specification
 */
export class SparkplugBClient extends EventEmitter {
  private config: SparkplugBConfig;
  private mqtt: MQTTClient;
  private bdSeq: number;
  private seq: number;
  private devices: Map<string, SparkplugBMetric[]> = new Map();
  private aliasMap: Map<string, number> = new Map();
  private currentAlias = 0;

  constructor(config: SparkplugBConfig) {
    super();
    this.config = {
      ...config,
      version: config.version || 'B3.0',
      bdSeq: config.bdSeq || 0,
      keepalive: config.keepalive || 60,
    };
    
    this.bdSeq = this.config.bdSeq!;
    this.seq = 0;

    // Create underlying MQTT client
    this.mqtt = new MQTTClient({
      brokerUrl: config.brokerUrl,
      clientId: config.clientId || `spB_${config.groupId}_${config.edgeNodeId}`,
      username: config.username,
      password: config.password,
      keepalive: config.keepalive,
      will: {
        topic: this.getNodeTopic('NDEATH'),
        payload: this.encodePayload({ timestamp: Date.now(), metrics: [], bdSeq: this.bdSeq }),
        qos: 1,
        retain: false,
      },
    });

    this.setupMqttHandlers();
  }

  private setupMqttHandlers(): void {
    this.mqtt.on('connected', () => {
      this.subscribeToCommands();
      this.emit('connected');
    });

    this.mqtt.on('disconnected', () => {
      this.emit('disconnected');
    });

    this.mqtt.on('message', (message: MQTTMessage) => {
      this.handleMessage(message);
    });

    this.mqtt.on('error', (error: Error) => {
      this.emit('error', error);
    });
  }

  /**
   * Connect to the Sparkplug B infrastructure
   */
  async connect(): Promise<void> {
    await this.mqtt.connect();
  }

  /**
   * Disconnect from the Sparkplug B infrastructure
   */
  async disconnect(): Promise<void> {
    // Send NDEATH
    await this.publishNodeDeath();
    await this.mqtt.disconnect();
  }

  /**
   * Subscribe to command topics
   */
  private async subscribeToCommands(): Promise<void> {
    // Subscribe to node commands
    await this.mqtt.subscribe(this.getNodeTopic('NCMD'), 1);
    
    // Subscribe to device commands for all devices
    await this.mqtt.subscribe(`spBv1.0/${this.config.groupId}/DCMD/${this.config.edgeNodeId}/+`, 1);
    
    // Subscribe to primary host state if configured
    if (this.config.primaryHostId) {
      await this.mqtt.subscribe(`spBv1.0/STATE/${this.config.primaryHostId}`, 1);
    }
  }

  /**
   * Publish Node Birth certificate
   */
  async publishNodeBirth(metrics: SparkplugBMetric[]): Promise<void> {
    this.bdSeq = (this.bdSeq + 1) % 256;
    this.seq = 0;

    // Assign aliases to metrics
    for (const metric of metrics) {
      if (!metric.alias) {
        metric.alias = this.getNextAlias(metric.name);
      }
    }

    const payload: SparkplugBPayload = {
      timestamp: Date.now(),
      metrics: [
        { name: 'bdSeq', dataType: 'uint64', value: this.bdSeq },
        ...metrics,
      ],
      seq: this.seq,
    };

    await this.mqtt.publish(this.getNodeTopic('NBIRTH'), this.encodePayload(payload), { qos: 1, retain: false });
    this.emit('nbirth', payload);
  }

  /**
   * Publish Node Death certificate
   */
  async publishNodeDeath(): Promise<void> {
    const payload: SparkplugBPayload = {
      timestamp: Date.now(),
      metrics: [],
      bdSeq: this.bdSeq,
    };

    await this.mqtt.publish(this.getNodeTopic('NDEATH'), this.encodePayload(payload), { qos: 1, retain: false });
    this.emit('ndeath', payload);
  }

  /**
   * Publish Device Birth certificate
   */
  async publishDeviceBirth(deviceId: string, metrics: SparkplugBMetric[]): Promise<void> {
    // Assign aliases
    for (const metric of metrics) {
      if (!metric.alias) {
        metric.alias = this.getNextAlias(`${deviceId}/${metric.name}`);
      }
    }

    this.devices.set(deviceId, metrics);

    const payload: SparkplugBPayload = {
      timestamp: Date.now(),
      metrics,
      seq: this.getNextSeq(),
    };

    await this.mqtt.publish(this.getDeviceTopic(deviceId, 'DBIRTH'), this.encodePayload(payload), { qos: 1, retain: false });
    this.emit('dbirth', { deviceId, payload });
  }

  /**
   * Publish Device Death certificate
   */
  async publishDeviceDeath(deviceId: string): Promise<void> {
    const payload: SparkplugBPayload = {
      timestamp: Date.now(),
      metrics: [],
      seq: this.getNextSeq(),
    };

    this.devices.delete(deviceId);

    await this.mqtt.publish(this.getDeviceTopic(deviceId, 'DDEATH'), this.encodePayload(payload), { qos: 1, retain: false });
    this.emit('ddeath', { deviceId, payload });
  }

  /**
   * Publish Node Data
   */
  async publishNodeData(metrics: SparkplugBMetric[]): Promise<void> {
    const payload: SparkplugBPayload = {
      timestamp: Date.now(),
      metrics: metrics.map(m => ({
        ...m,
        alias: m.alias ?? this.aliasMap.get(m.name),
      })),
      seq: this.getNextSeq(),
    };

    await this.mqtt.publish(this.getNodeTopic('NDATA'), this.encodePayload(payload), { qos: 0 });
    this.emit('ndata', payload);
  }

  /**
   * Publish Device Data
   */
  async publishDeviceData(deviceId: string, metrics: SparkplugBMetric[]): Promise<void> {
    const payload: SparkplugBPayload = {
      timestamp: Date.now(),
      metrics: metrics.map(m => ({
        ...m,
        alias: m.alias ?? this.aliasMap.get(`${deviceId}/${m.name}`),
      })),
      seq: this.getNextSeq(),
    };

    await this.mqtt.publish(this.getDeviceTopic(deviceId, 'DDATA'), this.encodePayload(payload), { qos: 0 });
    this.emit('ddata', { deviceId, payload });
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(message: MQTTMessage): void {
    const topic = message.topic;
    const parts = topic.split('/');

    if (parts[0] !== 'spBv1.0') return;

    const messageType = parts[2];
    const payload = this.decodePayload(message.payload as Buffer);

    switch (messageType) {
      case 'NCMD':
        this.emit('ncmd', payload);
        break;
      case 'DCMD':
        const deviceId = parts[4];
        this.emit('dcmd', { deviceId, payload });
        break;
      case 'STATE':
        const hostId = parts[2];
        this.emit('state', { hostId, payload });
        break;
    }
  }

  private getNodeTopic(messageType: SparkplugBMessageType): string {
    return `spBv1.0/${this.config.groupId}/${messageType}/${this.config.edgeNodeId}`;
  }

  private getDeviceTopic(deviceId: string, messageType: SparkplugBMessageType): string {
    return `spBv1.0/${this.config.groupId}/${messageType}/${this.config.edgeNodeId}/${deviceId}`;
  }

  private getNextSeq(): number {
    this.seq = (this.seq + 1) % 256;
    return this.seq;
  }

  private getNextAlias(name: string): number {
    const existingAlias = this.aliasMap.get(name);
    if (existingAlias !== undefined) return existingAlias;

    this.currentAlias++;
    this.aliasMap.set(name, this.currentAlias);
    return this.currentAlias;
  }

  private encodePayload(payload: SparkplugBPayload): string {
    // In a real implementation, this would use protobuf encoding
    // For simplicity, we use JSON
    return JSON.stringify(payload);
  }

  private decodePayload(data: Buffer | string): SparkplugBPayload {
    // In a real implementation, this would use protobuf decoding
    const str = typeof data === 'string' ? data : data.toString();
    return JSON.parse(str);
  }

  get isConnected(): boolean {
    return this.mqtt.isConnected;
  }

  get registeredDevices(): string[] {
    return Array.from(this.devices.keys());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified Namespace (UNS) Manager
// ─────────────────────────────────────────────────────────────────────────────

export interface UNSNode {
  path: string;
  name: string;
  type: 'enterprise' | 'site' | 'area' | 'line' | 'cell' | 'device' | 'tag';
  value?: unknown;
  timestamp?: Date;
  quality?: 'good' | 'bad' | 'uncertain';
  metadata?: Record<string, unknown>;
  children: Map<string, UNSNode>;
}

export interface UNSConfig {
  enterpriseName: string;
  sites: string[];
  sparkplug?: SparkplugBConfig;
  opcua?: OPCUAServerConfig[];
  mqtt?: MQTTClientConfig;
  retentionPolicy?: {
    raw: number; // hours
    aggregated: number; // days
  };
}

/**
 * Unified Namespace Manager
 * Provides a centralized, hierarchical data model for IIoT
 */
export class UnifiedNamespaceManager extends EventEmitter {
  private config: UNSConfig;
  private root: UNSNode;
  private sparkplug?: SparkplugBClient;
  private opcuaClients: Map<string, OPCUAClient> = new Map();
  private mqtt?: MQTTClient;
  private history: Map<string, { timestamp: Date; value: unknown }[]> = new Map();

  constructor(config: UNSConfig) {
    super();
    this.config = config;
    
    // Initialize root node
    this.root = {
      path: config.enterpriseName,
      name: config.enterpriseName,
      type: 'enterprise',
      children: new Map(),
    };

    // Initialize site nodes
    for (const site of config.sites) {
      this.root.children.set(site, {
        path: `${config.enterpriseName}/${site}`,
        name: site,
        type: 'site',
        children: new Map(),
      });
    }
  }

  /**
   * Initialize all connections
   */
  async initialize(): Promise<void> {
    // Initialize Sparkplug B if configured
    if (this.config.sparkplug) {
      this.sparkplug = new SparkplugBClient(this.config.sparkplug);
      this.setupSparkplugHandlers();
      await this.sparkplug.connect();
    }

    // Initialize OPC-UA clients if configured
    if (this.config.opcua) {
      for (const config of this.config.opcua) {
        const client = new OPCUAClient(config);
        await client.connect();
        this.opcuaClients.set(config.endpointUrl, client);
      }
    }

    // Initialize MQTT if configured
    if (this.config.mqtt) {
      this.mqtt = new MQTTClient(this.config.mqtt);
      this.setupMqttHandlers();
      await this.mqtt.connect();
    }

    this.emit('initialized');
  }

  private setupSparkplugHandlers(): void {
    if (!this.sparkplug) return;

    this.sparkplug.on('ddata', ({ deviceId, payload }) => {
      for (const metric of payload.metrics) {
        const path = `${this.config.sparkplug!.groupId}/${this.config.sparkplug!.edgeNodeId}/${deviceId}/${metric.name}`;
        this.updateValue(path, metric.value, 'good');
      }
    });

    this.sparkplug.on('ndata', (payload) => {
      for (const metric of payload.metrics) {
        const path = `${this.config.sparkplug!.groupId}/${this.config.sparkplug!.edgeNodeId}/${metric.name}`;
        this.updateValue(path, metric.value, 'good');
      }
    });
  }

  private setupMqttHandlers(): void {
    if (!this.mqtt) return;

    this.mqtt.onMessage('#', (message) => {
      try {
        const value = JSON.parse(message.payload.toString());
        this.updateValue(message.topic, value, 'good');
      } catch {
        this.updateValue(message.topic, message.payload.toString(), 'good');
      }
    });
  }

  /**
   * Update a value in the namespace
   */
  updateValue(path: string, value: unknown, quality: 'good' | 'bad' | 'uncertain' = 'good'): void {
    const node = this.ensureNodeExists(path);
    const timestamp = new Date();
    
    node.value = value;
    node.timestamp = timestamp;
    node.quality = quality;

    // Store in history
    this.addToHistory(path, timestamp, value);

    this.emit('valueChanged', { path, value, quality, timestamp });
  }

  /**
   * Get a value from the namespace
   */
  getValue(path: string): { value: unknown; timestamp?: Date; quality?: string } | null {
    const node = this.getNode(path);
    if (!node) return null;

    return {
      value: node.value,
      timestamp: node.timestamp,
      quality: node.quality,
    };
  }

  /**
   * Get historical values
   */
  getHistory(path: string, start: Date, end: Date): { timestamp: Date; value: unknown }[] {
    const history = this.history.get(path) || [];
    return history.filter(h => h.timestamp >= start && h.timestamp <= end);
  }

  /**
   * Subscribe to value changes
   */
  subscribe(pathPattern: string, callback: (data: { path: string; value: unknown; quality: string; timestamp: Date }) => void): () => void {
    const handler = (data: { path: string; value: unknown; quality: string; timestamp: Date }) => {
      if (this.pathMatchesPattern(data.path, pathPattern)) {
        callback(data);
      }
    };

    this.on('valueChanged', handler);

    // Return unsubscribe function
    return () => {
      this.off('valueChanged', handler);
    };
  }

  /**
   * Get all nodes under a path
   */
  browse(path?: string): UNSNode[] {
    const node = path ? this.getNode(path) : this.root;
    if (!node) return [];

    return Array.from(node.children.values());
  }

  private ensureNodeExists(path: string): UNSNode {
    const parts = path.split('/');
    let current = this.root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      let child = current.children.get(part);
      
      if (!child) {
        const fullPath = parts.slice(0, i + 1).join('/');
        child = {
          path: fullPath,
          name: part,
          type: i < 4 ? ['enterprise', 'site', 'area', 'line', 'cell'][i] as UNSNode['type'] : 'tag',
          children: new Map(),
        };
        current.children.set(part, child);
      }
      
      current = child;
    }

    return current;
  }

  private getNode(path: string): UNSNode | null {
    const parts = path.split('/');
    let current = this.root;

    for (const part of parts) {
      const child = current.children.get(part);
      if (!child) return null;
      current = child;
    }

    return current;
  }

  private addToHistory(path: string, timestamp: Date, value: unknown): void {
    const history = this.history.get(path) || [];
    history.push({ timestamp, value });

    // Apply retention policy
    if (this.config.retentionPolicy) {
      const cutoff = new Date(Date.now() - this.config.retentionPolicy.raw * 60 * 60 * 1000);
      const filtered = history.filter(h => h.timestamp >= cutoff);
      this.history.set(path, filtered);
    } else {
      // Default: keep last 1000 values
      if (history.length > 1000) {
        history.splice(0, history.length - 1000);
      }
      this.history.set(path, history);
    }
  }

  private pathMatchesPattern(path: string, pattern: string): boolean {
    const pathParts = path.split('/');
    const patternParts = pattern.split('/');

    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];
      const pathPart = pathParts[i];

      if (patternPart === '**') {
        return true;
      }

      if (patternPart === '*') {
        continue;
      }

      if (patternPart !== pathPart) {
        return false;
      }
    }

    return pathParts.length === patternParts.length;
  }

  /**
   * Shutdown all connections
   */
  async shutdown(): Promise<void> {
    if (this.sparkplug) {
      await this.sparkplug.disconnect();
    }

    for (const client of this.opcuaClients.values()) {
      await client.disconnect();
    }

    if (this.mqtt) {
      await this.mqtt.disconnect();
    }

    this.emit('shutdown');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Functions
// ─────────────────────────────────────────────────────────────────────────────

export function createOPCUAClient(config: OPCUAServerConfig): OPCUAClient {
  return new OPCUAClient(config);
}

export function createMQTTClient(config: MQTTClientConfig): MQTTClient {
  return new MQTTClient(config);
}

export function createSparkplugBClient(config: SparkplugBConfig): SparkplugBClient {
  return new SparkplugBClient(config);
}

export function createUnifiedNamespace(config: UNSConfig): UnifiedNamespaceManager {
  return new UnifiedNamespaceManager(config);
}
