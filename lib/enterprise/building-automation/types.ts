/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — Building Automation System Types
   
   Comprehensive type definitions for BACnet, Modbus, and HVAC equipment
   Designed for Trane Technologies Tracer SC/SC+ integration
   
   Protocols Supported:
   - BACnet/IP (ASHRAE 135-2020)
   - BACnet/SC (Secure Connect)
   - BACnet MS/TP
   - Modbus TCP/IP
   - Modbus RTU (RS-485)
   - LonTalk (legacy support)
   ═══════════════════════════════════════════════════════════════════════════ */

// ─────────────────────────────────────────────────────────────────────────────
// BACnet Object Types (per ASHRAE 135)
// ─────────────────────────────────────────────────────────────────────────────

export enum BACnetObjectType {
  ANALOG_INPUT = 0,
  ANALOG_OUTPUT = 1,
  ANALOG_VALUE = 2,
  BINARY_INPUT = 3,
  BINARY_OUTPUT = 4,
  BINARY_VALUE = 5,
  CALENDAR = 6,
  COMMAND = 7,
  DEVICE = 8,
  EVENT_ENROLLMENT = 9,
  FILE = 10,
  GROUP = 11,
  LOOP = 12,
  MULTI_STATE_INPUT = 13,
  MULTI_STATE_OUTPUT = 14,
  NOTIFICATION_CLASS = 15,
  PROGRAM = 16,
  SCHEDULE = 17,
  AVERAGING = 18,
  MULTI_STATE_VALUE = 19,
  TREND_LOG = 20,
  LIFE_SAFETY_POINT = 21,
  LIFE_SAFETY_ZONE = 22,
  ACCUMULATOR = 23,
  PULSE_CONVERTER = 24,
  EVENT_LOG = 25,
  GLOBAL_GROUP = 26,
  TREND_LOG_MULTIPLE = 27,
  LOAD_CONTROL = 28,
  STRUCTURED_VIEW = 29,
  ACCESS_DOOR = 30,
  // Extended types for HVAC
  NETWORK_SECURITY = 38,
  BIT_STRING_VALUE = 39,
  CHARACTER_STRING_VALUE = 40,
  DATE_PATTERN_VALUE = 41,
  DATE_VALUE = 42,
  DATETIME_PATTERN_VALUE = 43,
  DATETIME_VALUE = 44,
  INTEGER_VALUE = 45,
  LARGE_ANALOG_VALUE = 46,
  OCTET_STRING_VALUE = 47,
  POSITIVE_INTEGER_VALUE = 48,
  TIME_PATTERN_VALUE = 49,
  TIME_VALUE = 50,
  NOTIFICATION_FORWARDER = 51,
  ALERT_ENROLLMENT = 52,
  CHANNEL = 53,
  LIGHTING_OUTPUT = 54,
  BINARY_LIGHTING_OUTPUT = 55,
  NETWORK_PORT = 56,
  ELEVATOR_GROUP = 57,
  ESCALATOR = 58,
  LIFT = 59,
}

export enum BACnetPropertyId {
  PRESENT_VALUE = 85,
  OBJECT_NAME = 77,
  OBJECT_TYPE = 79,
  OBJECT_IDENTIFIER = 75,
  DESCRIPTION = 28,
  DEVICE_TYPE = 31,
  STATUS_FLAGS = 111,
  EVENT_STATE = 36,
  RELIABILITY = 103,
  OUT_OF_SERVICE = 81,
  UNITS = 117,
  MIN_PRES_VALUE = 69,
  MAX_PRES_VALUE = 65,
  PRIORITY_ARRAY = 87,
  RELINQUISH_DEFAULT = 104,
  COV_INCREMENT = 22,
  TIME_DELAY = 113,
  NOTIFICATION_CLASS = 17,
  HIGH_LIMIT = 45,
  LOW_LIMIT = 59,
  DEADBAND = 25,
  LIMIT_ENABLE = 52,
  EVENT_ENABLE = 35,
  ACKED_TRANSITIONS = 0,
  NOTIFY_TYPE = 72,
  EVENT_TIME_STAMPS = 130,
  PROFILE_NAME = 168,
  // Trane-specific properties
  ACTIVE_COV_SUBSCRIPTIONS = 152,
  PROTOCOL_SERVICES_SUPPORTED = 97,
  PROTOCOL_OBJECT_TYPES_SUPPORTED = 96,
  OBJECT_LIST = 76,
  STRUCTURED_OBJECT_LIST = 209,
}

export enum BACnetEngineeringUnits {
  // Temperature
  DEGREES_CELSIUS = 62,
  DEGREES_FAHRENHEIT = 64,
  DEGREES_KELVIN = 63,
  // Pressure
  PASCALS = 53,
  KILOPASCALS = 54,
  PSI = 56,
  INCHES_OF_WATER = 57,
  // Flow
  CUBIC_FEET_PER_MINUTE = 84,
  LITERS_PER_SECOND = 85,
  CUBIC_METERS_PER_HOUR = 135,
  // Power/Energy
  KILOWATTS = 48,
  WATTS = 47,
  KILOWATT_HOURS = 19,
  BTU_PER_HOUR = 20,
  TONS_REFRIGERATION = 43,
  // Humidity
  PERCENT_RELATIVE_HUMIDITY = 29,
  // Electrical
  AMPERES = 3,
  VOLTS = 5,
  HERTZ = 27,
  POWER_FACTOR = 44,
  // Misc
  PERCENT = 98,
  NO_UNITS = 95,
  DEGREES_ANGULAR = 90,
  REVOLUTIONS_PER_MINUTE = 104,
}

// ─────────────────────────────────────────────────────────────────────────────
// BACnet Device and Object Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface BACnetObjectId {
  type: BACnetObjectType;
  instance: number;
}

export interface BACnetDevice {
  deviceId: number;
  address: BACnetAddress;
  name: string;
  description?: string;
  vendorId: number;
  vendorName: string;
  modelName?: string;
  firmwareRevision?: string;
  applicationSoftwareVersion?: string;
  protocolVersion?: number;
  protocolRevision?: number;
  databaseRevision?: number;
  maxApduLengthAccepted: number;
  segmentationSupported: BACnetSegmentation;
  servicesSupported: BACnetServicesSupported;
  objectTypesSupported: BACnetObjectType[];
  objectList: BACnetObjectId[];
  lastSeen: Date;
  status: 'online' | 'offline' | 'unknown';
}

export interface BACnetAddress {
  network?: number;
  mac: string;
  ip?: string;
  port?: number;
}

export enum BACnetSegmentation {
  SEGMENTED_BOTH = 0,
  SEGMENTED_TRANSMIT = 1,
  SEGMENTED_RECEIVE = 2,
  NO_SEGMENTATION = 3,
}

export interface BACnetServicesSupported {
  acknowledgeAlarm: boolean;
  confirmedCOVNotification: boolean;
  confirmedEventNotification: boolean;
  getAlarmSummary: boolean;
  getEnrollmentSummary: boolean;
  subscribeCOV: boolean;
  atomicReadFile: boolean;
  atomicWriteFile: boolean;
  addListElement: boolean;
  removeListElement: boolean;
  createObject: boolean;
  deleteObject: boolean;
  readProperty: boolean;
  readPropertyConditional: boolean;
  readPropertyMultiple: boolean;
  writeProperty: boolean;
  writePropertyMultiple: boolean;
  deviceCommunicationControl: boolean;
  confirmedPrivateTransfer: boolean;
  confirmedTextMessage: boolean;
  reinitializeDevice: boolean;
  vtOpen: boolean;
  vtClose: boolean;
  vtData: boolean;
  readRange: boolean;
  lifeSafetyOperation: boolean;
  subscribeCOVProperty: boolean;
  getEventInformation: boolean;
}

export interface BACnetObject {
  objectId: BACnetObjectId;
  objectName: string;
  description?: string;
  presentValue: number | boolean | string | null;
  statusFlags: BACnetStatusFlags;
  eventState: BACnetEventState;
  reliability: BACnetReliability;
  outOfService: boolean;
  units?: BACnetEngineeringUnits;
  minPresValue?: number;
  maxPresValue?: number;
  covIncrement?: number;
  priorityArray?: (number | null)[];
  relinquishDefault?: number;
}

export interface BACnetStatusFlags {
  inAlarm: boolean;
  fault: boolean;
  overridden: boolean;
  outOfService: boolean;
}

export enum BACnetEventState {
  NORMAL = 0,
  FAULT = 1,
  OFFNORMAL = 2,
  HIGH_LIMIT = 3,
  LOW_LIMIT = 4,
  LIFE_SAFETY_ALARM = 5,
}

export enum BACnetReliability {
  NO_FAULT_DETECTED = 0,
  NO_SENSOR = 1,
  OVER_RANGE = 2,
  UNDER_RANGE = 3,
  OPEN_LOOP = 4,
  SHORTED_LOOP = 5,
  NO_OUTPUT = 6,
  UNRELIABLE_OTHER = 7,
  PROCESS_ERROR = 8,
  MULTI_STATE_FAULT = 9,
  CONFIGURATION_ERROR = 10,
  COMMUNICATION_FAILURE = 12,
  MEMBER_FAULT = 13,
  MONITORED_OBJECT_FAULT = 14,
  TRIPPED = 15,
}

// ─────────────────────────────────────────────────────────────────────────────
// BACnet/SC (Secure Connect) Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BACnetSCConfig {
  enabled: boolean;
  hubUri?: string;
  primaryHubUri?: string;
  failoverHubUri?: string;
  directConnectInitiate: boolean;
  directConnectAccept: boolean;
  certificatePath?: string;
  privateKeyPath?: string;
  caCertificatePath?: string;
  connectTimeout: number;
  heartbeatTimeout: number;
  disconnectTimeout: number;
  reconnectMinDelay: number;
  reconnectMaxDelay: number;
}

export interface BACnetSCConnection {
  connectionId: string;
  remoteDevice: number;
  remoteVmac: string;
  localVmac: string;
  state: BACnetSCConnectionState;
  connectTime?: Date;
  lastActivityTime?: Date;
  errorCode?: number;
  errorMessage?: string;
}

export enum BACnetSCConnectionState {
  IDLE = 0,
  AWAITING_REQUEST = 1,
  AWAITING_RESPONSE = 2,
  CONNECTED = 3,
  DISCONNECTING = 4,
  FAILED = 5,
}

// ─────────────────────────────────────────────────────────────────────────────
// Modbus Protocol Types
// ─────────────────────────────────────────────────────────────────────────────

export enum ModbusProtocol {
  TCP = 'tcp',
  RTU = 'rtu',
  ASCII = 'ascii',
  RTU_BUFFERED = 'rtu_buffered',
}

export enum ModbusFunctionCode {
  READ_COILS = 0x01,
  READ_DISCRETE_INPUTS = 0x02,
  READ_HOLDING_REGISTERS = 0x03,
  READ_INPUT_REGISTERS = 0x04,
  WRITE_SINGLE_COIL = 0x05,
  WRITE_SINGLE_REGISTER = 0x06,
  WRITE_MULTIPLE_COILS = 0x0f,
  WRITE_MULTIPLE_REGISTERS = 0x10,
  READ_WRITE_MULTIPLE_REGISTERS = 0x17,
  MASK_WRITE_REGISTER = 0x16,
  READ_FIFO_QUEUE = 0x18,
  READ_FILE_RECORD = 0x14,
  WRITE_FILE_RECORD = 0x15,
  READ_EXCEPTION_STATUS = 0x07,
  DIAGNOSTICS = 0x08,
  GET_COMM_EVENT_COUNTER = 0x0b,
  GET_COMM_EVENT_LOG = 0x0c,
  REPORT_SLAVE_ID = 0x11,
  READ_DEVICE_IDENTIFICATION = 0x2b,
}

export interface ModbusDevice {
  id: string;
  name: string;
  description?: string;
  protocol: ModbusProtocol;
  unitId: number;
  // TCP settings
  host?: string;
  port?: number;
  // RTU settings
  serialPort?: string;
  baudRate?: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: 'none' | 'even' | 'odd';
  // Common settings
  timeout: number;
  retries: number;
  pollIntervalMs: number;
  enabled: boolean;
  status: 'online' | 'offline' | 'error';
  lastPoll?: Date;
  errorCount: number;
  lastError?: string;
}

export interface ModbusRegister {
  address: number;
  name: string;
  description?: string;
  type: ModbusRegisterType;
  dataType: ModbusDataType;
  length: number;
  factor?: number;
  offset?: number;
  units?: string;
  min?: number;
  max?: number;
  enumValues?: Record<number, string>;
  readOnly: boolean;
  pollGroup?: string;
}

export enum ModbusRegisterType {
  COIL = 'coil',
  DISCRETE_INPUT = 'discrete_input',
  HOLDING_REGISTER = 'holding_register',
  INPUT_REGISTER = 'input_register',
}

export enum ModbusDataType {
  BOOL = 'bool',
  INT16 = 'int16',
  UINT16 = 'uint16',
  INT32 = 'int32',
  UINT32 = 'uint32',
  INT64 = 'int64',
  UINT64 = 'uint64',
  FLOAT32 = 'float32',
  FLOAT64 = 'float64',
  STRING = 'string',
  BITMASK = 'bitmask',
}

export interface ModbusReadResult {
  deviceId: string;
  register: ModbusRegister;
  rawValue: number | boolean | number[];
  scaledValue: number | boolean | string;
  timestamp: Date;
  quality: 'good' | 'bad' | 'uncertain';
  errorCode?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// HVAC Equipment Types (Trane-specific)
// ─────────────────────────────────────────────────────────────────────────────

export enum HVACEquipmentType {
  // Chillers
  CENTRIFUGAL_CHILLER = 'centrifugal_chiller',
  SCREW_CHILLER = 'screw_chiller',
  SCROLL_CHILLER = 'scroll_chiller',
  ABSORPTION_CHILLER = 'absorption_chiller',
  AIR_COOLED_CHILLER = 'air_cooled_chiller',
  WATER_COOLED_CHILLER = 'water_cooled_chiller',
  // Air Handlers
  AIR_HANDLING_UNIT = 'air_handling_unit',
  ROOFTOP_UNIT = 'rooftop_unit',
  MAKEUP_AIR_UNIT = 'makeup_air_unit',
  ENERGY_RECOVERY_UNIT = 'energy_recovery_unit',
  DEDICATED_OUTDOOR_AIR = 'dedicated_outdoor_air',
  FAN_COIL_UNIT = 'fan_coil_unit',
  // Terminal Units
  VAV_BOX = 'vav_box',
  FAN_POWERED_VAV = 'fan_powered_vav',
  BYPASS_VAV = 'bypass_vav',
  INDUCTION_UNIT = 'induction_unit',
  UNIT_VENTILATOR = 'unit_ventilator',
  // Pumps & Motors
  CHILLED_WATER_PUMP = 'chilled_water_pump',
  CONDENSER_WATER_PUMP = 'condenser_water_pump',
  HOT_WATER_PUMP = 'hot_water_pump',
  SUPPLY_FAN = 'supply_fan',
  RETURN_FAN = 'return_fan',
  EXHAUST_FAN = 'exhaust_fan',
  // Heat Rejection
  COOLING_TOWER = 'cooling_tower',
  DRY_COOLER = 'dry_cooler',
  FLUID_COOLER = 'fluid_cooler',
  // Heating
  BOILER = 'boiler',
  HEAT_PUMP = 'heat_pump',
  ELECTRIC_HEATER = 'electric_heater',
  // Controls
  BUILDING_CONTROLLER = 'building_controller',
  ZONE_CONTROLLER = 'zone_controller',
  UNITARY_CONTROLLER = 'unitary_controller',
  // Sensors
  TEMPERATURE_SENSOR = 'temperature_sensor',
  HUMIDITY_SENSOR = 'humidity_sensor',
  PRESSURE_SENSOR = 'pressure_sensor',
  CO2_SENSOR = 'co2_sensor',
  OCCUPANCY_SENSOR = 'occupancy_sensor',
  AIRFLOW_SENSOR = 'airflow_sensor',
  // Energy
  POWER_METER = 'power_meter',
  BTU_METER = 'btu_meter',
  VARIABLE_FREQUENCY_DRIVE = 'vfd',
}

export interface HVACEquipment {
  id: string;
  name: string;
  description?: string;
  type: HVACEquipmentType;
  manufacturer: string;
  model?: string;
  serialNumber?: string;
  location: EquipmentLocation;
  bacnetDevice?: BACnetDevice;
  modbusDevice?: ModbusDevice;
  points: HVACPoint[];
  status: EquipmentStatus;
  alarms: EquipmentAlarm[];
  maintenanceInfo?: MaintenanceInfo;
  specifications?: EquipmentSpecifications;
  tags: string[];
  customAttributes?: Record<string, unknown>;
}

export interface EquipmentLocation {
  site: string;
  building: string;
  floor?: string;
  zone?: string;
  room?: string;
  coordinates?: {
    latitude: number;
    longitude: number;
    elevation?: number;
  };
}

export interface HVACPoint {
  id: string;
  name: string;
  description?: string;
  pointType: HVACPointType;
  dataType: 'analog' | 'binary' | 'multistate' | 'string';
  units?: BACnetEngineeringUnits | string;
  bacnetObjectId?: BACnetObjectId;
  modbusRegister?: ModbusRegister;
  currentValue?: number | boolean | string | null;
  lastUpdate?: Date;
  quality: 'good' | 'bad' | 'uncertain' | 'stale';
  alarmState?: AlarmState;
  trending: boolean;
  writable: boolean;
  commandPriority?: number;
  limits?: {
    highAlarm?: number;
    highWarning?: number;
    lowWarning?: number;
    lowAlarm?: number;
    deadband?: number;
  };
}

export enum HVACPointType {
  // Temperature
  ZONE_TEMP = 'zone_temp',
  SUPPLY_AIR_TEMP = 'supply_air_temp',
  RETURN_AIR_TEMP = 'return_air_temp',
  MIXED_AIR_TEMP = 'mixed_air_temp',
  OUTDOOR_AIR_TEMP = 'outdoor_air_temp',
  DISCHARGE_AIR_TEMP = 'discharge_air_temp',
  CHILLED_WATER_SUPPLY_TEMP = 'chws_temp',
  CHILLED_WATER_RETURN_TEMP = 'chwr_temp',
  CONDENSER_WATER_SUPPLY_TEMP = 'cws_temp',
  CONDENSER_WATER_RETURN_TEMP = 'cwr_temp',
  HOT_WATER_SUPPLY_TEMP = 'hws_temp',
  HOT_WATER_RETURN_TEMP = 'hwr_temp',
  // Setpoints
  COOLING_SETPOINT = 'cooling_setpoint',
  HEATING_SETPOINT = 'heating_setpoint',
  OCCUPIED_COOLING_SETPOINT = 'occ_cooling_sp',
  OCCUPIED_HEATING_SETPOINT = 'occ_heating_sp',
  UNOCCUPIED_COOLING_SETPOINT = 'unocc_cooling_sp',
  UNOCCUPIED_HEATING_SETPOINT = 'unocc_heating_sp',
  // Flow & Pressure
  SUPPLY_AIRFLOW = 'supply_airflow',
  RETURN_AIRFLOW = 'return_airflow',
  OUTDOOR_AIRFLOW = 'outdoor_airflow',
  EXHAUST_AIRFLOW = 'exhaust_airflow',
  DUCT_STATIC_PRESSURE = 'duct_static_pressure',
  BUILDING_STATIC_PRESSURE = 'building_static_pressure',
  DIFFERENTIAL_PRESSURE = 'diff_pressure',
  WATER_FLOW = 'water_flow',
  // Humidity
  ZONE_HUMIDITY = 'zone_humidity',
  SUPPLY_AIR_HUMIDITY = 'supply_humidity',
  OUTDOOR_HUMIDITY = 'outdoor_humidity',
  // CO2 & Air Quality
  CO2_LEVEL = 'co2_level',
  PM25_LEVEL = 'pm25_level',
  TVOC_LEVEL = 'tvoc_level',
  // Commands
  DAMPER_POSITION = 'damper_position',
  VALVE_POSITION = 'valve_position',
  FAN_SPEED = 'fan_speed',
  VFD_SPEED = 'vfd_speed',
  COMPRESSOR_STAGE = 'compressor_stage',
  // Status
  OCCUPANCY_STATUS = 'occupancy_status',
  OPERATING_MODE = 'operating_mode',
  EQUIPMENT_STATUS = 'equipment_status',
  FAULT_STATUS = 'fault_status',
  RUN_STATUS = 'run_status',
  // Energy
  POWER_CONSUMPTION = 'power_consumption',
  ENERGY_CONSUMPTION = 'energy_consumption',
  EFFICIENCY = 'efficiency',
  COP = 'cop',
  // Chiller-specific
  EVAPORATOR_PRESSURE = 'evap_pressure',
  CONDENSER_PRESSURE = 'cond_pressure',
  OIL_PRESSURE = 'oil_pressure',
  OIL_TEMPERATURE = 'oil_temp',
  LEAVING_CHILLED_WATER_TEMP = 'lchwt',
  ENTERING_CHILLED_WATER_TEMP = 'echwt',
  LEAVING_CONDENSER_WATER_TEMP = 'lcwt',
  ENTERING_CONDENSER_WATER_TEMP = 'ecwt',
  COMPRESSOR_RLA = 'compressor_rla',
  PERCENT_RLA = 'percent_rla',
  // Generic
  CUSTOM = 'custom',
}

export interface EquipmentStatus {
  operatingState: 'off' | 'starting' | 'running' | 'stopping' | 'fault' | 'maintenance';
  mode?: 'auto' | 'manual' | 'off' | 'cool' | 'heat' | 'economizer' | 'standby';
  lastStateChange: Date;
  runHours?: number;
  startCount?: number;
  efficiency?: number;
  loadPercent?: number;
}

export interface AlarmState {
  severity: 'normal' | 'advisory' | 'minor' | 'major' | 'critical';
  message?: string;
  timestamp?: Date;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
}

export interface EquipmentAlarm {
  id: string;
  pointId?: string;
  severity: AlarmState['severity'];
  type: 'high_limit' | 'low_limit' | 'fault' | 'communication' | 'maintenance' | 'custom';
  message: string;
  timestamp: Date;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  clearedAt?: Date;
  notes?: string;
}

export interface MaintenanceInfo {
  lastServiceDate?: Date;
  nextServiceDate?: Date;
  warrantyExpiration?: Date;
  serviceContractId?: string;
  serviceProvider?: string;
  maintenanceHistory: MaintenanceRecord[];
}

export interface MaintenanceRecord {
  id: string;
  date: Date;
  type: 'preventive' | 'corrective' | 'inspection' | 'calibration' | 'replacement';
  description: string;
  technician: string;
  duration: number; // minutes
  cost?: number;
  parts?: string[];
  notes?: string;
}

export interface EquipmentSpecifications {
  // Capacity
  nominalCapacity?: number;
  capacityUnits?: string;
  minCapacity?: number;
  maxCapacity?: number;
  // Electrical
  voltage?: number;
  phase?: 1 | 3;
  frequency?: number;
  fullLoadAmps?: number;
  runningLoadAmps?: number;
  // Refrigerant (for chillers/heat pumps)
  refrigerantType?: string;
  refrigerantCharge?: number;
  // Flow (for pumps)
  nominalFlow?: number;
  flowUnits?: string;
  head?: number;
  // Efficiency
  eer?: number;
  seer?: number;
  cop?: number;
  iplv?: number;
  nplv?: number;
  // Custom
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Trane Tracer SC/SC+ Specific Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TracerController {
  id: string;
  type: 'SC' | 'SC+';
  name: string;
  ipAddress: string;
  macAddress: string;
  firmwareVersion: string;
  softwareVersion: string;
  serialNumber: string;
  site: string;
  building: string;
  status: 'online' | 'offline' | 'warning' | 'alarm';
  lastCommunication: Date;
  bacnetDeviceId: number;
  protocols: TracerProtocol[];
  connectedDevices: number;
  alarmCount: number;
  configuration: TracerConfiguration;
}

export interface TracerProtocol {
  name: 'BACnet/IP' | 'BACnet/SC' | 'BACnet MS/TP' | 'Modbus TCP' | 'Modbus RTU' | 'LonTalk';
  enabled: boolean;
  port?: number;
  networkNumber?: number;
  maxDevices?: number;
}

export interface TracerConfiguration {
  timezone: string;
  daylightSavings: boolean;
  dateFormat: string;
  timeFormat: string;
  temperatureUnits: 'F' | 'C';
  pressureUnits: 'inWC' | 'Pa' | 'kPa';
  flowUnits: 'CFM' | 'L/s' | 'm³/h';
  ntpServer?: string;
  ntpEnabled: boolean;
  webEnabled: boolean;
  webPort: number;
  sslEnabled: boolean;
  sslPort: number;
  alarmNotifications: AlarmNotificationConfig;
  trendLogging: TrendLoggingConfig;
  schedules: ScheduleConfig[];
}

export interface AlarmNotificationConfig {
  emailEnabled: boolean;
  emailRecipients: string[];
  smsEnabled: boolean;
  smsRecipients: string[];
  snmpEnabled: boolean;
  snmpTrapDestination?: string;
  bacnetAlarmEnabled: boolean;
  minSeverity: AlarmState['severity'];
}

export interface TrendLoggingConfig {
  enabled: boolean;
  defaultInterval: number; // seconds
  maxStorageDays: number;
  compressionEnabled: boolean;
  exportFormat: 'CSV' | 'JSON' | 'BACnet';
}

export interface ScheduleConfig {
  id: string;
  name: string;
  type: 'weekly' | 'exception' | 'calendar';
  enabled: boolean;
  effectiveDate?: Date;
  expirationDate?: Date;
  weeklySchedule?: WeeklySchedule;
  exceptionSchedules?: ExceptionSchedule[];
  assignedObjects: BACnetObjectId[];
}

export interface WeeklySchedule {
  monday: ScheduleEntry[];
  tuesday: ScheduleEntry[];
  wednesday: ScheduleEntry[];
  thursday: ScheduleEntry[];
  friday: ScheduleEntry[];
  saturday: ScheduleEntry[];
  sunday: ScheduleEntry[];
}

export interface ScheduleEntry {
  time: string; // HH:mm format
  value: number | boolean | string;
}

export interface ExceptionSchedule {
  date: Date;
  recurring: boolean;
  entries: ScheduleEntry[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Site Management Types (Tracer Ensemble)
// ─────────────────────────────────────────────────────────────────────────────

export interface Site {
  id: string;
  name: string;
  code: string;
  description?: string;
  address: Address;
  timezone: string;
  buildings: Building[];
  contacts: SiteContact[];
  status: 'active' | 'inactive' | 'maintenance';
  createdAt: Date;
  updatedAt: Date;
}

export interface Address {
  street1: string;
  street2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
}

export interface Building {
  id: string;
  siteId: string;
  name: string;
  code: string;
  description?: string;
  floors: Floor[];
  grossArea: number;
  areaUnits: 'sqft' | 'sqm';
  yearBuilt?: number;
  occupancyType: string;
  maxOccupancy?: number;
  operatingHours: OperatingHours;
  controllers: TracerController[];
  equipment: HVACEquipment[];
  energyMeters: EnergyMeter[];
  status: 'active' | 'inactive' | 'renovation';
}

export interface Floor {
  id: string;
  buildingId: string;
  name: string;
  level: number;
  area: number;
  zones: Zone[];
}

export interface Zone {
  id: string;
  floorId: string;
  name: string;
  type: 'office' | 'conference' | 'lobby' | 'hallway' | 'restroom' | 'mechanical' | 'storage' | 'other';
  area?: number;
  maxOccupancy?: number;
  equipment: string[]; // Equipment IDs
  points: string[]; // Point IDs
  setpoints: ZoneSetpoints;
}

export interface ZoneSetpoints {
  occupiedCooling: number;
  occupiedHeating: number;
  unoccupiedCooling: number;
  unoccupiedHeating: number;
  standbyOffset: number;
  deadband: number;
}

export interface OperatingHours {
  monday: { open: string; close: string } | null;
  tuesday: { open: string; close: string } | null;
  wednesday: { open: string; close: string } | null;
  thursday: { open: string; close: string } | null;
  friday: { open: string; close: string } | null;
  saturday: { open: string; close: string } | null;
  sunday: { open: string; close: string } | null;
  holidays: string[]; // Holiday calendar IDs
}

export interface SiteContact {
  id: string;
  name: string;
  role: 'facility_manager' | 'building_engineer' | 'security' | 'emergency' | 'vendor';
  email: string;
  phone: string;
  mobile?: string;
  notifications: ('alarm' | 'maintenance' | 'report')[];
}

export interface EnergyMeter {
  id: string;
  name: string;
  type: 'electric' | 'gas' | 'water' | 'steam' | 'chilled_water' | 'hot_water';
  utility: string;
  accountNumber?: string;
  meterNumber?: string;
  modbusDevice?: ModbusDevice;
  bacnetDevice?: BACnetDevice;
  currentReading?: number;
  units: string;
  lastReadingTime?: Date;
  demandPeak?: number;
  demandPeakTime?: Date;
  costRate?: number;
  demandRate?: number;
  billingPeriodStart?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Energy Management Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EnergyData {
  meterId: string;
  timestamp: Date;
  consumption: number;
  demand?: number;
  powerFactor?: number;
  cost?: number;
  quality: 'actual' | 'estimated' | 'interpolated';
}

export interface EnergyReport {
  siteId: string;
  buildingId?: string;
  period: {
    start: Date;
    end: Date;
    type: 'hour' | 'day' | 'week' | 'month' | 'year';
  };
  totalConsumption: number;
  peakDemand: number;
  peakDemandTime: Date;
  totalCost: number;
  byMeterType: Record<EnergyMeter['type'], {
    consumption: number;
    cost: number;
    percentage: number;
  }>;
  byBuilding?: Record<string, {
    consumption: number;
    cost: number;
    areaIntensity: number; // per unit area
  }>;
  comparison?: {
    previousPeriod: number;
    samePeroidLastYear?: number;
    baseline?: number;
  };
  weather?: {
    avgTemperature: number;
    hdd: number; // Heating Degree Days
    cdd: number; // Cooling Degree Days
  };
}

export interface DemandResponse {
  id: string;
  eventType: 'shed' | 'shift' | 'shimmy';
  status: 'scheduled' | 'active' | 'completed' | 'cancelled';
  startTime: Date;
  endTime: Date;
  targetReduction: number; // kW
  actualReduction?: number;
  strategy: DemandResponseStrategy[];
  notification?: string;
}

export interface DemandResponseStrategy {
  equipmentId: string;
  action: 'setback' | 'cycle' | 'shed' | 'stage_limit';
  parameters: Record<string, number | boolean | string>;
  priority: number;
  estimatedSavings: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fault Detection & Diagnostics Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FaultRule {
  id: string;
  name: string;
  description: string;
  category: 'energy' | 'comfort' | 'maintenance' | 'safety' | 'operational';
  severity: AlarmState['severity'];
  equipmentTypes: HVACEquipmentType[];
  conditions: FaultCondition[];
  operator: 'AND' | 'OR';
  suppressionTime?: number; // minutes
  enabled: boolean;
  actions: FaultAction[];
}

export interface FaultCondition {
  pointType: HVACPointType;
  operator: '>' | '<' | '>=' | '<=' | '=' | '!=' | 'between' | 'outside';
  value: number | [number, number];
  duration?: number; // seconds
  comparison?: {
    pointType: HVACPointType;
    operator: '>' | '<' | '>=' | '<=' | '=' | '!=';
    offset?: number;
  };
}

export interface FaultAction {
  type: 'alarm' | 'email' | 'command' | 'workorder' | 'log';
  parameters: Record<string, unknown>;
}

export interface FaultEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  equipmentId: string;
  equipmentName: string;
  severity: AlarmState['severity'];
  category: FaultRule['category'];
  timestamp: Date;
  duration?: number;
  status: 'active' | 'acknowledged' | 'resolved' | 'suppressed';
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  resolution?: string;
  points: {
    pointId: string;
    pointName: string;
    value: number | boolean | string;
    timestamp: Date;
  }[];
  estimatedImpact?: {
    energy?: number;
    cost?: number;
    comfort?: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Compliance & Reporting Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ComplianceFramework {
  id: string;
  name: string;
  version: string;
  type: 'energy' | 'environmental' | 'safety' | 'operational';
  requirements: ComplianceRequirement[];
}

export interface ComplianceRequirement {
  id: string;
  section: string;
  title: string;
  description: string;
  measurementPoints: HVACPointType[];
  threshold?: {
    min?: number;
    max?: number;
    target?: number;
  };
  frequency: 'continuous' | 'hourly' | 'daily' | 'monthly' | 'annual';
  reportingRequired: boolean;
}

export interface ComplianceReport {
  frameworkId: string;
  frameworkName: string;
  period: {
    start: Date;
    end: Date;
  };
  siteId: string;
  buildingId?: string;
  overallCompliance: number; // percentage
  requirements: {
    requirementId: string;
    title: string;
    status: 'compliant' | 'non_compliant' | 'not_applicable' | 'insufficient_data';
    value?: number;
    threshold?: ComplianceRequirement['threshold'];
    details?: string;
  }[];
  recommendations: string[];
  generatedAt: Date;
  generatedBy: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration Configuration Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildingAutomationConfig {
  bacnet: {
    enabled: boolean;
    localDeviceId: number;
    localIpAddress: string;
    broadcastAddress: string;
    port: number;
    apduTimeout: number;
    apduRetries: number;
    maxSegmentsAccepted: number;
    maxApduLengthAccepted: number;
    secureConnect?: BACnetSCConfig;
    foreignDeviceRegistration?: {
      enabled: boolean;
      bbmdAddress: string;
      bbmdPort: number;
      ttl: number;
    };
  };
  modbus: {
    enabled: boolean;
    defaultTimeout: number;
    defaultRetries: number;
    pollIntervalMs: number;
    maxConcurrentConnections: number;
  };
  discovery: {
    autoDiscovery: boolean;
    discoveryInterval: number; // seconds
    includeNetworkNumbers: number[];
    excludeDeviceIds: number[];
  };
  trending: {
    enabled: boolean;
    storageProvider: 'local' | 'database' | 'timeseries';
    defaultInterval: number;
    retentionDays: number;
    compressionEnabled: boolean;
  };
  alarming: {
    enabled: boolean;
    aggregationWindowMs: number;
    maxActiveAlarms: number;
    notificationChannels: ('email' | 'sms' | 'webhook' | 'bacnet')[];
  };
}

