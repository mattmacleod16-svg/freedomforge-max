/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — Trane Tracer SC/SC+ Connector
   
   Enterprise-grade integration with Trane Technologies building automation
   Supports:
   - Tracer SC System Controller
   - Tracer SC+ System Controller
   - Tracer Synchrony User Interface
   - Tracer Ensemble multi-site management
   
   Features:
   - BACnet/IP and BACnet/SC connectivity
   - Equipment discovery and monitoring
   - Schedule management
   - Alarm and event handling
   - Trend data collection
   - Energy management integration
   - Multi-site orchestration
   ═══════════════════════════════════════════════════════════════════════════ */

import { EventEmitter } from 'events';
import { BACnetClient, createBACnetClient } from './bacnet-client';
import { ModbusClient, createModbusClient } from './modbus-client';
import {
  HVACEquipmentType,
  HVACPointType,
} from './types';
import type {
  TracerController,
  TracerProtocol,
  TracerConfiguration,
  HVACEquipment,
  HVACPoint,
  EquipmentStatus,
  EquipmentAlarm,
  EquipmentLocation,
  Site,
  Building,
  Zone,
  ZoneSetpoints,
  EnergyMeter,
  EnergyData,
  FaultEvent,
  ScheduleConfig,
  WeeklySchedule,
  BACnetDevice,
  BACnetAddress,
  AlarmState,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Trane Vendor-Specific Object Types
// ─────────────────────────────────────────────────────────────────────────────

// Trane uses vendor-specific BACnet objects starting at 128
const TRANE_OBJECT_TYPES = {
  TRACER_UNIT: 128,
  CHILLER: 129,
  AIR_HANDLER: 130,
  VAV_BOX: 131,
  ROOFTOP_UNIT: 132,
  COOLING_TOWER: 133,
  BOILER: 134,
  PUMP: 135,
  FAN: 136,
  ZONE_SENSOR: 137,
  THERMOSTAT: 138,
} as const;

// Trane vendor-specific property IDs
const TRANE_PROPERTIES = {
  EQUIPMENT_MODEL: 512,
  EQUIPMENT_SERIAL: 513,
  CAPACITY_TONS: 514,
  EFFICIENCY_RATING: 515,
  REFRIGERANT_TYPE: 516,
  LAST_SERVICE_DATE: 517,
  RUNTIME_HOURS: 518,
  START_COUNT: 519,
  CURRENT_LOAD_PERCENT: 520,
  ENTERING_WATER_TEMP: 521,
  LEAVING_WATER_TEMP: 522,
  COMPRESSOR_STATUS: 523,
  OIL_PRESSURE: 524,
  EVAPORATOR_PRESSURE: 525,
  CONDENSER_PRESSURE: 526,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Tracer Connector Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface TracerConnectorConfig {
  // Primary controller settings
  controllers: TracerControllerConfig[];
  
  // BACnet settings
  bacnet: {
    localDeviceId: number;
    localIpAddress?: string;
    broadcastAddress?: string;
    port?: number;
    apduTimeout?: number;
  };
  
  // Polling settings
  polling: {
    equipmentIntervalMs: number;
    pointIntervalMs: number;
    alarmIntervalMs: number;
    trendIntervalMs: number;
  };
  
  // Feature flags
  features: {
    autoDiscovery: boolean;
    covSubscriptions: boolean;
    trendCollection: boolean;
    alarmNotifications: boolean;
    scheduleSync: boolean;
    energyMonitoring: boolean;
  };
}

export interface TracerControllerConfig {
  id: string;
  name: string;
  type: 'SC' | 'SC+';
  ipAddress: string;
  bacnetDeviceId: number;
  site: string;
  building: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tracer Connector Events
// ─────────────────────────────────────────────────────────────────────────────

export interface TracerConnectorEvents {
  'connected': (controller: TracerController) => void;
  'disconnected': (controllerId: string) => void;
  'equipment-discovered': (equipment: HVACEquipment) => void;
  'equipment-updated': (equipment: HVACEquipment) => void;
  'point-updated': (equipmentId: string, point: HVACPoint) => void;
  'alarm': (alarm: EquipmentAlarm) => void;
  'alarm-cleared': (alarmId: string) => void;
  'fault-detected': (fault: FaultEvent) => void;
  'energy-data': (data: EnergyData) => void;
  'error': (error: Error) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tracer Connector Implementation
// ─────────────────────────────────────────────────────────────────────────────

export class TracerConnector extends EventEmitter {
  private config: TracerConnectorConfig;
  private bacnetClient: BACnetClient;
  private modbusClients: Map<string, ModbusClient> = new Map();
  private controllers: Map<string, TracerController> = new Map();
  private equipment: Map<string, HVACEquipment> = new Map();
  private points: Map<string, HVACPoint> = new Map();
  private alarms: Map<string, EquipmentAlarm> = new Map();
  private pollTimers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning = false;

  constructor(config: TracerConnectorConfig) {
    super();
    this.config = config;
    
    // Initialize BACnet client
    this.bacnetClient = createBACnetClient({
      localDeviceId: config.bacnet.localDeviceId,
      localIpAddress: config.bacnet.localIpAddress,
      broadcastAddress: config.bacnet.broadcastAddress,
      port: config.bacnet.port,
      apduTimeout: config.bacnet.apduTimeout,
      vendorId: 555, // FreedomForge
      vendorName: 'FreedomForge',
      modelName: 'Enterprise BAS Gateway',
    });

    // Set up BACnet event handlers
    this.setupBACnetHandlers();
  }

  private setupBACnetHandlers(): void {
    this.bacnetClient.on('device-discovered', (device) => {
      this.handleDeviceDiscovered(device);
    });

    this.bacnetClient.on('cov-notification', (deviceId, objectId, values) => {
      this.handleCOVNotification(deviceId, objectId, values);
    });

    this.bacnetClient.on('alarm', (deviceId, eventData) => {
      this.handleAlarmEvent(deviceId, eventData);
    });

    this.bacnetClient.on('error', (error) => {
      this.emit('error', error);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle Methods
  // ─────────────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      // Start BACnet client
      await this.bacnetClient.start();

      // Connect to configured controllers
      for (const controllerConfig of this.config.controllers) {
        await this.connectController(controllerConfig);
      }

      // Start auto-discovery if enabled
      if (this.config.features.autoDiscovery) {
        await this.discoverDevices();
      }

      // Start polling
      this.startPolling();

      this.isRunning = true;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    // Stop polling
    for (const timer of this.pollTimers.values()) {
      clearTimeout(timer);
    }
    this.pollTimers.clear();

    // Disconnect Modbus clients
    for (const client of this.modbusClients.values()) {
      await client.disconnect();
    }
    this.modbusClients.clear();

    // Stop BACnet client
    await this.bacnetClient.stop();

    this.isRunning = false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Controller Management
  // ─────────────────────────────────────────────────────────────────────────

  private async connectController(config: TracerControllerConfig): Promise<void> {
    const address: BACnetAddress = {
      ip: config.ipAddress,
      port: 47808,
      mac: config.ipAddress,
    };

    try {
      // Get device info via BACnet
      const deviceInfo = await this.bacnetClient.getDeviceInfo(address, config.bacnetDeviceId);

      const controller: TracerController = {
        id: config.id,
        type: config.type,
        name: config.name,
        ipAddress: config.ipAddress,
        macAddress: '', // Will be populated from device
        firmwareVersion: deviceInfo.firmwareRevision || 'Unknown',
        softwareVersion: deviceInfo.applicationSoftwareVersion || 'Unknown',
        serialNumber: '', // Read from vendor-specific property
        site: config.site,
        building: config.building,
        status: 'online',
        lastCommunication: new Date(),
        bacnetDeviceId: config.bacnetDeviceId,
        protocols: this.detectProtocols(config.type),
        connectedDevices: 0,
        alarmCount: 0,
        configuration: await this.getControllerConfiguration(address, config.bacnetDeviceId),
      };

      this.controllers.set(config.id, controller);
      this.emit('connected', controller);

      // Discover equipment on this controller
      await this.discoverControllerEquipment(controller, address);
    } catch (error) {
      this.emit('error', new Error(`Failed to connect to controller ${config.name}: ${error}`));
    }
  }

  private detectProtocols(type: 'SC' | 'SC+'): TracerProtocol[] {
    const protocols: TracerProtocol[] = [
      { name: 'BACnet/IP', enabled: true, port: 47808 },
      { name: 'BACnet MS/TP', enabled: true, networkNumber: 1 },
    ];

    if (type === 'SC+') {
      protocols.push({ name: 'BACnet/SC', enabled: true });
      protocols.push({ name: 'Modbus TCP', enabled: true, port: 502 });
    }

    return protocols;
  }

  private async getControllerConfiguration(
    address: BACnetAddress,
    deviceId: number
  ): Promise<TracerConfiguration> {
    // Default configuration - would be read from controller
    return {
      timezone: 'America/New_York',
      daylightSavings: true,
      dateFormat: 'MM/DD/YYYY',
      timeFormat: '12h',
      temperatureUnits: 'F',
      pressureUnits: 'inWC',
      flowUnits: 'CFM',
      ntpEnabled: true,
      webEnabled: true,
      webPort: 80,
      sslEnabled: true,
      sslPort: 443,
      alarmNotifications: {
        emailEnabled: false,
        emailRecipients: [],
        smsEnabled: false,
        smsRecipients: [],
        snmpEnabled: false,
        bacnetAlarmEnabled: true,
        minSeverity: 'minor',
      },
      trendLogging: {
        enabled: true,
        defaultInterval: 300,
        maxStorageDays: 365,
        compressionEnabled: true,
        exportFormat: 'CSV',
      },
      schedules: [],
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Equipment Discovery
  // ─────────────────────────────────────────────────────────────────────────

  async discoverDevices(): Promise<BACnetDevice[]> {
    const devices = await this.bacnetClient.whoIs();
    
    for (const device of devices) {
      await this.handleDeviceDiscovered(device);
    }

    return devices;
  }

  private async handleDeviceDiscovered(device: BACnetDevice): Promise<void> {
    // Check if this is a Trane device
    if (device.vendorId === 2 || device.vendorId === 343) { // Trane vendor IDs
      await this.processTraneDevice(device);
    }
  }

  private async processTraneDevice(device: BACnetDevice): Promise<void> {
    // Read object list to find equipment
    try {
      const objectList = device.objectList || [];
      
      for (const objectId of objectList) {
        const equipmentType = this.mapObjectToEquipmentType(objectId.type);
        if (equipmentType) {
          await this.discoverEquipment(device, objectId, equipmentType);
        }
      }
    } catch (error) {
      this.emit('error', new Error(`Failed to process Trane device ${device.deviceId}: ${error}`));
    }
  }

  private async discoverControllerEquipment(
    controller: TracerController,
    address: BACnetAddress
  ): Promise<void> {
    try {
      // Read object list from controller
      const objectList = await this.bacnetClient.readProperty(
        address,
        8, // DEVICE
        controller.bacnetDeviceId,
        76 // OBJECT_LIST
      ) as Array<{ type: number; instance: number }>;

      for (const objectId of objectList || []) {
        const equipmentType = this.mapObjectToEquipmentType(objectId.type);
        if (equipmentType) {
          const device: BACnetDevice = {
            deviceId: controller.bacnetDeviceId,
            address,
            name: controller.name,
            vendorId: 343,
            vendorName: 'Trane',
            maxApduLengthAccepted: 1476,
            segmentationSupported: 0,
            servicesSupported: {} as any,
            objectTypesSupported: [],
            objectList: [],
            lastSeen: new Date(),
            status: 'online',
          };
          await this.discoverEquipment(device, objectId, equipmentType);
        }
      }
    } catch (error) {
      // Object list read may not be supported, try discovery
      this.emit('error', new Error(`Could not enumerate objects: ${error}`));
    }
  }

  private async discoverEquipment(
    device: BACnetDevice,
    objectId: { type: number; instance: number },
    equipmentType: HVACEquipmentType
  ): Promise<void> {
    try {
      // Read equipment properties
      const name = await this.bacnetClient.readProperty(
        device.address,
        objectId.type,
        objectId.instance,
        77 // OBJECT_NAME
      ) as string;

      const description = await this.bacnetClient.readProperty(
        device.address,
        objectId.type,
        objectId.instance,
        28 // DESCRIPTION
      ) as string;

      const equipment: HVACEquipment = {
        id: `${device.deviceId}:${objectId.type}:${objectId.instance}`,
        name: name || `${equipmentType} ${objectId.instance}`,
        description: description || undefined,
        type: equipmentType,
        manufacturer: 'Trane',
        location: {
          site: 'Default Site',
          building: 'Default Building',
        },
        bacnetDevice: device,
        points: [],
        status: {
          operatingState: 'off',
          lastStateChange: new Date(),
        },
        alarms: [],
        tags: ['trane', equipmentType],
      };

      // Discover points for this equipment
      equipment.points = await this.discoverEquipmentPoints(device, objectId);

      this.equipment.set(equipment.id, equipment);
      this.emit('equipment-discovered', equipment);

      // Subscribe to COV if enabled
      if (this.config.features.covSubscriptions) {
        await this.subscribeToEquipmentCOV(equipment);
      }
    } catch (error) {
      this.emit('error', new Error(`Failed to discover equipment: ${error}`));
    }
  }

  private async discoverEquipmentPoints(
    device: BACnetDevice,
    parentObjectId: { type: number; instance: number }
  ): Promise<HVACPoint[]> {
    const points: HVACPoint[] = [];

    // Define standard points for each equipment type
    const standardPoints = this.getStandardPointsForType(parentObjectId.type);

    for (const pointDef of standardPoints) {
      const point: HVACPoint = {
        id: `${device.deviceId}:${pointDef.objectType}:${pointDef.instance}`,
        name: pointDef.name,
        description: pointDef.description,
        pointType: pointDef.pointType,
        dataType: pointDef.dataType,
        units: pointDef.units,
        bacnetObjectId: {
          type: pointDef.objectType,
          instance: pointDef.instance,
        },
        quality: 'good',
        trending: pointDef.trending || false,
        writable: pointDef.writable || false,
        commandPriority: pointDef.writable ? 8 : undefined,
      };

      // Try to read current value
      try {
        const value = await this.bacnetClient.readProperty(
          device.address,
          pointDef.objectType,
          pointDef.instance,
          85 // PRESENT_VALUE
        );
        point.currentValue = value as number | boolean | string;
        point.lastUpdate = new Date();
      } catch {
        // Point may not exist, skip
        continue;
      }

      points.push(point);
      this.points.set(point.id, point);
    }

    return points;
  }

  private getStandardPointsForType(
    objectType: number
  ): Array<{
    name: string;
    description?: string;
    pointType: HVACPointType;
    dataType: 'analog' | 'binary' | 'multistate';
    objectType: number;
    instance: number;
    units?: number;
    trending?: boolean;
    writable?: boolean;
  }> {
    // Return standard points based on equipment type
    // This would be expanded for each equipment type
    const baseInstance = objectType * 1000;

    switch (objectType) {
      case TRANE_OBJECT_TYPES.CHILLER:
        return [
          { name: 'Chilled Water Supply Temp', pointType: HVACPointType.LEAVING_CHILLED_WATER_TEMP, dataType: 'analog', objectType: 0, instance: baseInstance + 1, units: 64, trending: true },
          { name: 'Chilled Water Return Temp', pointType: HVACPointType.ENTERING_CHILLED_WATER_TEMP, dataType: 'analog', objectType: 0, instance: baseInstance + 2, units: 64, trending: true },
          { name: 'Condenser Water Supply Temp', pointType: HVACPointType.LEAVING_CONDENSER_WATER_TEMP, dataType: 'analog', objectType: 0, instance: baseInstance + 3, units: 64, trending: true },
          { name: 'Condenser Water Return Temp', pointType: HVACPointType.ENTERING_CONDENSER_WATER_TEMP, dataType: 'analog', objectType: 0, instance: baseInstance + 4, units: 64, trending: true },
          { name: 'Percent RLA', pointType: HVACPointType.PERCENT_RLA, dataType: 'analog', objectType: 0, instance: baseInstance + 5, units: 98, trending: true },
          { name: 'Run Status', pointType: HVACPointType.RUN_STATUS, dataType: 'binary', objectType: 3, instance: baseInstance + 1 },
          { name: 'Fault Status', pointType: HVACPointType.FAULT_STATUS, dataType: 'binary', objectType: 3, instance: baseInstance + 2 },
          { name: 'Enable Command', pointType: HVACPointType.EQUIPMENT_STATUS, dataType: 'binary', objectType: 4, instance: baseInstance + 1, writable: true },
          { name: 'Setpoint', pointType: HVACPointType.COOLING_SETPOINT, dataType: 'analog', objectType: 2, instance: baseInstance + 1, units: 64, writable: true },
        ];

      case TRANE_OBJECT_TYPES.AIR_HANDLER:
        return [
          { name: 'Supply Air Temp', pointType: HVACPointType.SUPPLY_AIR_TEMP, dataType: 'analog', objectType: 0, instance: baseInstance + 1, units: 64, trending: true },
          { name: 'Return Air Temp', pointType: HVACPointType.RETURN_AIR_TEMP, dataType: 'analog', objectType: 0, instance: baseInstance + 2, units: 64, trending: true },
          { name: 'Mixed Air Temp', pointType: HVACPointType.MIXED_AIR_TEMP, dataType: 'analog', objectType: 0, instance: baseInstance + 3, units: 64, trending: true },
          { name: 'Outside Air Temp', pointType: HVACPointType.OUTDOOR_AIR_TEMP, dataType: 'analog', objectType: 0, instance: baseInstance + 4, units: 64, trending: true },
          { name: 'Supply Airflow', pointType: HVACPointType.SUPPLY_AIRFLOW, dataType: 'analog', objectType: 0, instance: baseInstance + 5, units: 84, trending: true },
          { name: 'Duct Static Pressure', pointType: HVACPointType.DUCT_STATIC_PRESSURE, dataType: 'analog', objectType: 0, instance: baseInstance + 6, units: 57 },
          { name: 'Supply Fan Status', pointType: HVACPointType.RUN_STATUS, dataType: 'binary', objectType: 3, instance: baseInstance + 1 },
          { name: 'Cooling Valve', pointType: HVACPointType.VALVE_POSITION, dataType: 'analog', objectType: 1, instance: baseInstance + 1, units: 98 },
          { name: 'Heating Valve', pointType: HVACPointType.VALVE_POSITION, dataType: 'analog', objectType: 1, instance: baseInstance + 2, units: 98 },
          { name: 'Outside Air Damper', pointType: HVACPointType.DAMPER_POSITION, dataType: 'analog', objectType: 1, instance: baseInstance + 3, units: 98 },
          { name: 'Fan Speed Command', pointType: HVACPointType.FAN_SPEED, dataType: 'analog', objectType: 1, instance: baseInstance + 4, units: 98, writable: true },
        ];

      case TRANE_OBJECT_TYPES.VAV_BOX:
        return [
          { name: 'Zone Temp', pointType: HVACPointType.ZONE_TEMP, dataType: 'analog', objectType: 0, instance: baseInstance + 1, units: 64, trending: true },
          { name: 'Discharge Air Temp', pointType: HVACPointType.DISCHARGE_AIR_TEMP, dataType: 'analog', objectType: 0, instance: baseInstance + 2, units: 64 },
          { name: 'Airflow', pointType: HVACPointType.SUPPLY_AIRFLOW, dataType: 'analog', objectType: 0, instance: baseInstance + 3, units: 84 },
          { name: 'Damper Position', pointType: HVACPointType.DAMPER_POSITION, dataType: 'analog', objectType: 1, instance: baseInstance + 1, units: 98 },
          { name: 'Reheat Valve', pointType: HVACPointType.VALVE_POSITION, dataType: 'analog', objectType: 1, instance: baseInstance + 2, units: 98 },
          { name: 'Occupied Cooling Setpoint', pointType: HVACPointType.OCCUPIED_COOLING_SETPOINT, dataType: 'analog', objectType: 2, instance: baseInstance + 1, units: 64, writable: true },
          { name: 'Occupied Heating Setpoint', pointType: HVACPointType.OCCUPIED_HEATING_SETPOINT, dataType: 'analog', objectType: 2, instance: baseInstance + 2, units: 64, writable: true },
          { name: 'Occupancy Status', pointType: HVACPointType.OCCUPANCY_STATUS, dataType: 'binary', objectType: 3, instance: baseInstance + 1 },
        ];

      default:
        return [];
    }
  }

  private mapObjectToEquipmentType(objectType: number): HVACEquipmentType | null {
    const mapping: Record<number, HVACEquipmentType> = {
      [TRANE_OBJECT_TYPES.CHILLER]: HVACEquipmentType.CENTRIFUGAL_CHILLER,
      [TRANE_OBJECT_TYPES.AIR_HANDLER]: HVACEquipmentType.AIR_HANDLING_UNIT,
      [TRANE_OBJECT_TYPES.VAV_BOX]: HVACEquipmentType.VAV_BOX,
      [TRANE_OBJECT_TYPES.ROOFTOP_UNIT]: HVACEquipmentType.ROOFTOP_UNIT,
      [TRANE_OBJECT_TYPES.COOLING_TOWER]: HVACEquipmentType.COOLING_TOWER,
      [TRANE_OBJECT_TYPES.BOILER]: HVACEquipmentType.BOILER,
      [TRANE_OBJECT_TYPES.PUMP]: HVACEquipmentType.CHILLED_WATER_PUMP,
      [TRANE_OBJECT_TYPES.FAN]: HVACEquipmentType.SUPPLY_FAN,
    };

    return mapping[objectType] || null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COV Subscriptions
  // ─────────────────────────────────────────────────────────────────────────

  private async subscribeToEquipmentCOV(equipment: HVACEquipment): Promise<void> {
    if (!equipment.bacnetDevice) return;

    for (const point of equipment.points) {
      if (point.bacnetObjectId && point.trending) {
        try {
          await this.bacnetClient.subscribeCOV(
            equipment.bacnetDevice.address,
            point.bacnetObjectId.type,
            point.bacnetObjectId.instance,
            3600, // 1 hour lifetime
            true
          );
        } catch {
          // COV subscription may not be supported
        }
      }
    }
  }

  private handleCOVNotification(
    deviceId: number,
    objectId: { type: number; instance: number },
    values: unknown
  ): void {
    const pointId = `${deviceId}:${objectId.type}:${objectId.instance}`;
    const point = this.points.get(pointId);

    if (point) {
      // Update point value
      const valueData = values as { presentValue?: unknown; statusFlags?: unknown };
      if (valueData.presentValue !== undefined) {
        point.currentValue = valueData.presentValue as number | boolean | string;
        point.lastUpdate = new Date();
        point.quality = 'good';

        // Find equipment and emit update
        for (const equipment of this.equipment.values()) {
          if (equipment.points.some((p) => p.id === pointId)) {
            this.emit('point-updated', equipment.id, point);
            break;
          }
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Alarm Handling
  // ─────────────────────────────────────────────────────────────────────────

  private handleAlarmEvent(deviceId: number, eventData: unknown): void {
    // Process alarm event data
    const alarm: EquipmentAlarm = {
      id: `alarm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      severity: 'minor',
      type: 'fault',
      message: 'Alarm event received',
      timestamp: new Date(),
      acknowledged: false,
    };

    this.alarms.set(alarm.id, alarm);
    this.emit('alarm', alarm);
  }

  async acknowledgeAlarm(alarmId: string, acknowledgedBy: string): Promise<void> {
    const alarm = this.alarms.get(alarmId);
    if (alarm) {
      alarm.acknowledged = true;
      alarm.acknowledgedBy = acknowledgedBy;
      alarm.acknowledgedAt = new Date();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Polling
  // ─────────────────────────────────────────────────────────────────────────

  private startPolling(): void {
    // Poll equipment status
    const equipmentTimer = setInterval(
      () => this.pollEquipment(),
      this.config.polling.equipmentIntervalMs
    );
    this.pollTimers.set('equipment', equipmentTimer);

    // Poll points (if COV not enabled)
    if (!this.config.features.covSubscriptions) {
      const pointTimer = setInterval(
        () => this.pollPoints(),
        this.config.polling.pointIntervalMs
      );
      this.pollTimers.set('points', pointTimer);
    }

    // Poll alarms
    const alarmTimer = setInterval(
      () => this.pollAlarms(),
      this.config.polling.alarmIntervalMs
    );
    this.pollTimers.set('alarms', alarmTimer);
  }

  private async pollEquipment(): Promise<void> {
    for (const equipment of this.equipment.values()) {
      try {
        await this.updateEquipmentStatus(equipment);
      } catch (error) {
        this.emit('error', new Error(`Failed to poll equipment ${equipment.id}: ${error}`));
      }
    }
  }

  private async pollPoints(): Promise<void> {
    for (const equipment of this.equipment.values()) {
      if (!equipment.bacnetDevice) continue;

      for (const point of equipment.points) {
        if (!point.bacnetObjectId) continue;

        try {
          const value = await this.bacnetClient.readProperty(
            equipment.bacnetDevice.address,
            point.bacnetObjectId.type,
            point.bacnetObjectId.instance,
            85 // PRESENT_VALUE
          );

          point.currentValue = value as number | boolean | string;
          point.lastUpdate = new Date();
          point.quality = 'good';

          this.emit('point-updated', equipment.id, point);
        } catch {
          point.quality = 'bad';
        }
      }
    }
  }

  private async pollAlarms(): Promise<void> {
    // Poll for new alarms from controllers
    for (const controller of this.controllers.values()) {
      // Would implement alarm polling here
    }
  }

  private async updateEquipmentStatus(equipment: HVACEquipment): Promise<void> {
    if (!equipment.bacnetDevice) return;

    // Update status based on point values
    const runStatusPoint = equipment.points.find((p) => p.pointType === HVACPointType.RUN_STATUS);
    const faultStatusPoint = equipment.points.find((p) => p.pointType === HVACPointType.FAULT_STATUS);

    if (runStatusPoint?.currentValue !== undefined) {
      const isRunning = runStatusPoint.currentValue === true || runStatusPoint.currentValue === 1;
      const hasFault = faultStatusPoint?.currentValue === true || faultStatusPoint?.currentValue === 1;

      const newState: EquipmentStatus['operatingState'] = hasFault
        ? 'fault'
        : isRunning
        ? 'running'
        : 'off';

      if (equipment.status.operatingState !== newState) {
        equipment.status.operatingState = newState;
        equipment.status.lastStateChange = new Date();
        this.emit('equipment-updated', equipment);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Command Methods
  // ─────────────────────────────────────────────────────────────────────────

  async setPointValue(
    equipmentId: string,
    pointId: string,
    value: number | boolean,
    priority: number = 8
  ): Promise<void> {
    const equipment = this.equipment.get(equipmentId);
    if (!equipment?.bacnetDevice) {
      throw new Error(`Equipment not found: ${equipmentId}`);
    }

    const point = equipment.points.find((p) => p.id === pointId);
    if (!point?.bacnetObjectId) {
      throw new Error(`Point not found: ${pointId}`);
    }

    if (!point.writable) {
      throw new Error(`Point is not writable: ${pointId}`);
    }

    await this.bacnetClient.writeProperty(
      equipment.bacnetDevice.address,
      point.bacnetObjectId.type,
      point.bacnetObjectId.instance,
      85, // PRESENT_VALUE
      value,
      priority
    );

    // Update local value
    point.currentValue = value;
    point.lastUpdate = new Date();
    this.emit('point-updated', equipmentId, point);
  }

  async setZoneSetpoints(zoneId: string, setpoints: Partial<ZoneSetpoints>): Promise<void> {
    // Find VAV boxes in zone and update setpoints
    for (const equipment of this.equipment.values()) {
      if (equipment.type !== HVACEquipmentType.VAV_BOX) continue;

      for (const point of equipment.points) {
        if (setpoints.occupiedCooling && point.pointType === HVACPointType.OCCUPIED_COOLING_SETPOINT) {
          await this.setPointValue(equipment.id, point.id, setpoints.occupiedCooling);
        }
        if (setpoints.occupiedHeating && point.pointType === HVACPointType.OCCUPIED_HEATING_SETPOINT) {
          await this.setPointValue(equipment.id, point.id, setpoints.occupiedHeating);
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Schedule Management
  // ─────────────────────────────────────────────────────────────────────────

  async getSchedules(controllerId: string): Promise<ScheduleConfig[]> {
    const controller = this.controllers.get(controllerId);
    if (!controller) {
      throw new Error(`Controller not found: ${controllerId}`);
    }

    return controller.configuration.schedules;
  }

  async updateSchedule(controllerId: string, schedule: ScheduleConfig): Promise<void> {
    const controller = this.controllers.get(controllerId);
    if (!controller) {
      throw new Error(`Controller not found: ${controllerId}`);
    }

    // Update schedule in controller
    // This would write the schedule to the BACnet schedule object
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Accessors
  // ─────────────────────────────────────────────────────────────────────────

  getControllers(): TracerController[] {
    return Array.from(this.controllers.values());
  }

  getController(id: string): TracerController | undefined {
    return this.controllers.get(id);
  }

  getEquipment(): HVACEquipment[] {
    return Array.from(this.equipment.values());
  }

  getEquipmentById(id: string): HVACEquipment | undefined {
    return this.equipment.get(id);
  }

  getEquipmentByType(type: HVACEquipmentType): HVACEquipment[] {
    return Array.from(this.equipment.values()).filter((e) => e.type === type);
  }

  getAlarms(severity?: AlarmState['severity']): EquipmentAlarm[] {
    const alarms = Array.from(this.alarms.values());
    if (severity) {
      return alarms.filter((a) => a.severity === severity);
    }
    return alarms;
  }

  getActiveAlarms(): EquipmentAlarm[] {
    return Array.from(this.alarms.values()).filter((a) => !a.clearedAt);
  }

  get running(): boolean {
    return this.isRunning;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Function
// ─────────────────────────────────────────────────────────────────────────────

export function createTracerConnector(config?: Partial<TracerConnectorConfig>): TracerConnector {
  const defaultConfig: TracerConnectorConfig = {
    controllers: [],
    bacnet: {
      localDeviceId: parseInt(process.env.BACNET_DEVICE_ID ?? '999999', 10),
      localIpAddress: process.env.BACNET_LOCAL_IP,
      broadcastAddress: process.env.BACNET_BROADCAST_ADDRESS ?? '255.255.255.255',
      port: parseInt(process.env.BACNET_PORT ?? '47808', 10),
      apduTimeout: parseInt(process.env.BACNET_TIMEOUT ?? '6000', 10),
    },
    polling: {
      equipmentIntervalMs: 60000,
      pointIntervalMs: 15000,
      alarmIntervalMs: 5000,
      trendIntervalMs: 300000,
    },
    features: {
      autoDiscovery: true,
      covSubscriptions: true,
      trendCollection: true,
      alarmNotifications: true,
      scheduleSync: true,
      energyMonitoring: true,
    },
  };

  return new TracerConnector({
    ...defaultConfig,
    ...config,
    bacnet: { ...defaultConfig.bacnet, ...config?.bacnet },
    polling: { ...defaultConfig.polling, ...config?.polling },
    features: { ...defaultConfig.features, ...config?.features },
  });
}
