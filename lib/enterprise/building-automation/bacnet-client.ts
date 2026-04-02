/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — BACnet Client Implementation
   
   A robust BACnet/IP and BACnet/SC client for building automation integration
   Designed for enterprise-grade Trane Technologies Tracer SC/SC+ connectivity
   
   Features:
   - Device discovery (Who-Is/I-Am)
   - Property read/write (ReadProperty, WriteProperty, ReadPropertyMultiple)
   - COV subscriptions
   - Alarm & event notifications
   - Time synchronization
   - BACnet/SC secure communications
   
   Based on ASHRAE 135-2020 specification
   ═══════════════════════════════════════════════════════════════════════════ */

import * as dgram from 'dgram';
import { EventEmitter } from 'events';
import {
  BACnetObjectType,
  BACnetPropertyId,
  BACnetEngineeringUnits,
} from './types';

import type {
  BACnetDevice,
  BACnetObject,
  BACnetObjectId,
  BACnetAddress,
  BACnetStatusFlags,
  BACnetEventState,
  BACnetReliability,
  BACnetSegmentation,
  BACnetServicesSupported,
  BACnetSCConfig,
  BuildingAutomationConfig,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// BACnet Protocol Constants
// ─────────────────────────────────────────────────────────────────────────────

const BACNET_IP_PORT = 47808;
const BACNET_MAX_APDU = 1476;
const BACNET_PROTOCOL_VERSION = 1;
const BACNET_MAX_INSTANCE = 0x3FFFFF;

// BACnet Virtual Link Layer (BVLL) Types
enum BVLLType {
  BVLC_RESULT = 0x00,
  WRITE_BROADCAST_DISTRIBUTION_TABLE = 0x01,
  READ_BROADCAST_DISTRIBUTION_TABLE = 0x02,
  READ_BROADCAST_DISTRIBUTION_TABLE_ACK = 0x03,
  FORWARDED_NPDU = 0x04,
  REGISTER_FOREIGN_DEVICE = 0x05,
  READ_FOREIGN_DEVICE_TABLE = 0x06,
  READ_FOREIGN_DEVICE_TABLE_ACK = 0x07,
  DELETE_FOREIGN_DEVICE_TABLE_ENTRY = 0x08,
  DISTRIBUTE_BROADCAST_TO_NETWORK = 0x09,
  ORIGINAL_UNICAST_NPDU = 0x0a,
  ORIGINAL_BROADCAST_NPDU = 0x0b,
  SECURE_BVLL = 0x0c,
}

// Network Protocol Data Unit (NPDU) Network Layer Message Types
enum NPDUNetworkMessage {
  WHO_IS_ROUTER_TO_NETWORK = 0x00,
  I_AM_ROUTER_TO_NETWORK = 0x01,
  I_COULD_BE_ROUTER_TO_NETWORK = 0x02,
  REJECT_MESSAGE_TO_NETWORK = 0x03,
  ROUTER_BUSY_TO_NETWORK = 0x04,
  ROUTER_AVAILABLE_TO_NETWORK = 0x05,
  INITIALIZE_ROUTING_TABLE = 0x06,
  INITIALIZE_ROUTING_TABLE_ACK = 0x07,
  ESTABLISH_CONNECTION_TO_NETWORK = 0x08,
  DISCONNECT_CONNECTION_TO_NETWORK = 0x09,
  WHAT_IS_NETWORK_NUMBER = 0x12,
  NETWORK_NUMBER_IS = 0x13,
}

// Application Protocol Data Unit (APDU) Types
enum APDUType {
  CONFIRMED_REQUEST = 0x00,
  UNCONFIRMED_REQUEST = 0x10,
  SIMPLE_ACK = 0x20,
  COMPLEX_ACK = 0x30,
  SEGMENT_ACK = 0x40,
  ERROR = 0x50,
  REJECT = 0x60,
  ABORT = 0x70,
}

// Confirmed Service Choices
enum ConfirmedServiceChoice {
  ACKNOWLEDGE_ALARM = 0,
  CONFIRMED_COV_NOTIFICATION = 1,
  CONFIRMED_EVENT_NOTIFICATION = 2,
  GET_ALARM_SUMMARY = 3,
  GET_ENROLLMENT_SUMMARY = 4,
  SUBSCRIBE_COV = 5,
  ATOMIC_READ_FILE = 6,
  ATOMIC_WRITE_FILE = 7,
  ADD_LIST_ELEMENT = 8,
  REMOVE_LIST_ELEMENT = 9,
  CREATE_OBJECT = 10,
  DELETE_OBJECT = 11,
  READ_PROPERTY = 12,
  READ_PROPERTY_CONDITIONAL = 13,
  READ_PROPERTY_MULTIPLE = 14,
  WRITE_PROPERTY = 15,
  WRITE_PROPERTY_MULTIPLE = 16,
  DEVICE_COMMUNICATION_CONTROL = 17,
  CONFIRMED_PRIVATE_TRANSFER = 18,
  CONFIRMED_TEXT_MESSAGE = 19,
  REINITIALIZE_DEVICE = 20,
  VT_OPEN = 21,
  VT_CLOSE = 22,
  VT_DATA = 23,
  READ_RANGE = 26,
  LIFE_SAFETY_OPERATION = 27,
  SUBSCRIBE_COV_PROPERTY = 28,
  GET_EVENT_INFORMATION = 29,
}

// Unconfirmed Service Choices
enum UnconfirmedServiceChoice {
  I_AM = 0,
  I_HAVE = 1,
  UNCONFIRMED_COV_NOTIFICATION = 2,
  UNCONFIRMED_EVENT_NOTIFICATION = 3,
  UNCONFIRMED_PRIVATE_TRANSFER = 4,
  UNCONFIRMED_TEXT_MESSAGE = 5,
  TIME_SYNCHRONIZATION = 6,
  WHO_HAS = 7,
  WHO_IS = 8,
  UTC_TIME_SYNCHRONIZATION = 9,
  WRITE_GROUP = 10,
}

// ─────────────────────────────────────────────────────────────────────────────
// BACnet Encoding/Decoding Utilities
// ─────────────────────────────────────────────────────────────────────────────

class BACnetEncoder {
  private buffer: Buffer;
  private offset: number;

  constructor(size = 1500) {
    this.buffer = Buffer.alloc(size);
    this.offset = 0;
  }

  writeByte(value: number): this {
    this.buffer.writeUInt8(value, this.offset++);
    return this;
  }

  writeUInt16BE(value: number): this {
    this.buffer.writeUInt16BE(value, this.offset);
    this.offset += 2;
    return this;
  }

  writeUInt32BE(value: number): this {
    this.buffer.writeUInt32BE(value, this.offset);
    this.offset += 4;
    return this;
  }

  writeBytes(data: Buffer | number[]): this {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    buf.copy(this.buffer, this.offset);
    this.offset += buf.length;
    return this;
  }

  writeTag(tagNumber: number, contextSpecific: boolean, length: number): this {
    let tag = (tagNumber << 4) | (contextSpecific ? 0x08 : 0x00);
    if (length <= 4) {
      tag |= length;
      this.writeByte(tag);
    } else if (length <= 253) {
      tag |= 5;
      this.writeByte(tag);
      this.writeByte(length);
    } else if (length <= 65535) {
      tag |= 5;
      this.writeByte(tag);
      this.writeByte(254);
      this.writeUInt16BE(length);
    } else {
      tag |= 5;
      this.writeByte(tag);
      this.writeByte(255);
      this.writeUInt32BE(length);
    }
    return this;
  }

  writeOpeningTag(tagNumber: number): this {
    this.writeByte((tagNumber << 4) | 0x0e);
    return this;
  }

  writeClosingTag(tagNumber: number): this {
    this.writeByte((tagNumber << 4) | 0x0f);
    return this;
  }

  writeUnsigned(value: number, tagNumber?: number): this {
    let len: number;
    if (value <= 0xff) len = 1;
    else if (value <= 0xffff) len = 2;
    else if (value <= 0xffffff) len = 3;
    else len = 4;

    if (tagNumber !== undefined) {
      this.writeTag(tagNumber, true, len);
    } else {
      this.writeTag(2, false, len); // Application tag for unsigned
    }

    if (len === 1) this.writeByte(value);
    else if (len === 2) this.writeUInt16BE(value);
    else if (len === 3) {
      this.writeByte((value >> 16) & 0xff);
      this.writeUInt16BE(value & 0xffff);
    } else this.writeUInt32BE(value);

    return this;
  }

  writeObjectId(type: number, instance: number, tagNumber?: number): this {
    const value = ((type & 0x3ff) << 22) | (instance & 0x3fffff);
    if (tagNumber !== undefined) {
      this.writeTag(tagNumber, true, 4);
    } else {
      this.writeTag(12, false, 4); // Application tag for object ID
    }
    this.writeUInt32BE(value);
    return this;
  }

  writeBoolean(value: boolean, tagNumber?: number): this {
    if (tagNumber !== undefined) {
      this.writeTag(tagNumber, true, 1);
      this.writeByte(value ? 1 : 0);
    } else {
      this.writeByte(value ? 0x11 : 0x10); // Application boolean
    }
    return this;
  }

  writeReal(value: number, tagNumber?: number): this {
    if (tagNumber !== undefined) {
      this.writeTag(tagNumber, true, 4);
    } else {
      this.writeTag(4, false, 4); // Application tag for real
    }
    this.buffer.writeFloatBE(value, this.offset);
    this.offset += 4;
    return this;
  }

  writeDouble(value: number, tagNumber?: number): this {
    if (tagNumber !== undefined) {
      this.writeTag(tagNumber, true, 8);
    } else {
      this.writeTag(5, false, 8); // Application tag for double
    }
    this.buffer.writeDoubleBE(value, this.offset);
    this.offset += 8;
    return this;
  }

  writeString(value: string, tagNumber?: number): this {
    const strBuf = Buffer.from(value, 'utf8');
    const len = strBuf.length + 1; // +1 for encoding byte
    if (tagNumber !== undefined) {
      this.writeTag(tagNumber, true, len);
    } else {
      this.writeTag(7, false, len); // Application tag for string
    }
    this.writeByte(0); // UTF-8 encoding
    this.writeBytes(strBuf);
    return this;
  }

  writeEnumerated(value: number, tagNumber?: number): this {
    let len: number;
    if (value <= 0xff) len = 1;
    else if (value <= 0xffff) len = 2;
    else if (value <= 0xffffff) len = 3;
    else len = 4;

    if (tagNumber !== undefined) {
      this.writeTag(tagNumber, true, len);
    } else {
      this.writeTag(9, false, len); // Application tag for enumerated
    }

    if (len === 1) this.writeByte(value);
    else if (len === 2) this.writeUInt16BE(value);
    else if (len === 3) {
      this.writeByte((value >> 16) & 0xff);
      this.writeUInt16BE(value & 0xffff);
    } else this.writeUInt32BE(value);

    return this;
  }

  getBuffer(): Buffer {
    return this.buffer.subarray(0, this.offset);
  }

  get length(): number {
    return this.offset;
  }
}

class BACnetDecoder {
  private buffer: Buffer;
  private offset: number;

  constructor(buffer: Buffer, offset = 0) {
    this.buffer = buffer;
    this.offset = offset;
  }

  get remaining(): number {
    return this.buffer.length - this.offset;
  }

  get position(): number {
    return this.offset;
  }

  readByte(): number {
    return this.buffer.readUInt8(this.offset++);
  }

  readUInt16BE(): number {
    const value = this.buffer.readUInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  readUInt32BE(): number {
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  readBytes(length: number): Buffer {
    const data = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return data;
  }

  peekByte(): number {
    return this.buffer.readUInt8(this.offset);
  }

  readTag(): { tagNumber: number; contextSpecific: boolean; length: number; isOpeningTag: boolean; isClosingTag: boolean } {
    const tag = this.readByte();
    const tagNumber = (tag >> 4) & 0x0f;
    const contextSpecific = (tag & 0x08) !== 0;
    let length = tag & 0x07;
    const isOpeningTag = length === 6;
    const isClosingTag = length === 7;

    if (length === 5) {
      length = this.readByte();
      if (length === 254) {
        length = this.readUInt16BE();
      } else if (length === 255) {
        length = this.readUInt32BE();
      }
    }

    return { tagNumber, contextSpecific, length, isOpeningTag, isClosingTag };
  }

  readUnsigned(length: number): number {
    if (length === 1) return this.readByte();
    if (length === 2) return this.readUInt16BE();
    if (length === 3) {
      return (this.readByte() << 16) | this.readUInt16BE();
    }
    return this.readUInt32BE();
  }

  readObjectId(): { type: number; instance: number } {
    const value = this.readUInt32BE();
    return {
      type: (value >> 22) & 0x3ff,
      instance: value & 0x3fffff,
    };
  }

  readReal(): number {
    const value = this.buffer.readFloatBE(this.offset);
    this.offset += 4;
    return value;
  }

  readDouble(): number {
    const value = this.buffer.readDoubleBE(this.offset);
    this.offset += 8;
    return value;
  }

  readString(length: number): string {
    const encoding = this.readByte();
    const strBuf = this.readBytes(length - 1);
    // UTF-8 encoding (0) is most common
    return strBuf.toString(encoding === 0 ? 'utf8' : 'latin1');
  }

  skip(bytes: number): void {
    this.offset += bytes;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BACnet Client Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface BACnetClientConfig {
  localDeviceId: number;
  localIpAddress?: string;
  broadcastAddress?: string;
  port?: number;
  apduTimeout?: number;
  apduRetries?: number;
  maxSegmentsAccepted?: number;
  maxApduLengthAccepted?: number;
  vendorId?: number;
  vendorName?: string;
  modelName?: string;
  applicationSoftwareVersion?: string;
  secureConnect?: BACnetSCConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// BACnet Client Events
// ─────────────────────────────────────────────────────────────────────────────

export interface BACnetClientEvents {
  'device-discovered': (device: BACnetDevice) => void;
  'device-offline': (deviceId: number) => void;
  'cov-notification': (deviceId: number, objectId: BACnetObjectId, values: Partial<BACnetObject>) => void;
  'alarm': (deviceId: number, eventData: unknown) => void;
  'error': (error: Error) => void;
  'connected': () => void;
  'disconnected': () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// BACnet Client Implementation
// ─────────────────────────────────────────────────────────────────────────────

export class BACnetClient extends EventEmitter {
  private config: Required<Omit<BACnetClientConfig, 'secureConnect'>> & { secureConnect?: BACnetSCConfig };
  private socket: dgram.Socket | null = null;
  private invokeId = 0;
  private pendingRequests: Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private discoveredDevices: Map<number, BACnetDevice> = new Map();
  private covSubscriptions: Map<string, {
    deviceId: number;
    objectId: BACnetObjectId;
    subscriberProcessId: number;
    lifetime: number;
    renewTimer?: NodeJS.Timeout;
  }> = new Map();
  private isRunning = false;

  constructor(config: BACnetClientConfig) {
    super();
    this.config = {
      localDeviceId: config.localDeviceId,
      localIpAddress: config.localIpAddress || '0.0.0.0',
      broadcastAddress: config.broadcastAddress || '255.255.255.255',
      port: config.port || BACNET_IP_PORT,
      apduTimeout: config.apduTimeout || 6000,
      apduRetries: config.apduRetries || 3,
      maxSegmentsAccepted: config.maxSegmentsAccepted || 65,
      maxApduLengthAccepted: config.maxApduLengthAccepted || BACNET_MAX_APDU,
      vendorId: config.vendorId || 555, // FreedomForge vendor ID
      vendorName: config.vendorName || 'FreedomForge',
      modelName: config.modelName || 'Enterprise BAS Gateway',
      applicationSoftwareVersion: config.applicationSoftwareVersion || '1.0.0',
      secureConnect: config.secureConnect,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle Methods
  // ─────────────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.isRunning) return;

    return new Promise((resolve, reject) => {
      try {
        this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        this.socket.on('error', (err) => {
          this.emit('error', err);
          if (!this.isRunning) {
            reject(err);
          }
        });

        this.socket.on('message', (msg, rinfo) => {
          this.handleMessage(msg, rinfo);
        });

        this.socket.on('listening', () => {
          this.isRunning = true;
          this.socket!.setBroadcast(true);
          this.emit('connected');
          resolve();
        });

        this.socket.bind(this.config.port, this.config.localIpAddress);
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    // Clear all pending requests
    for (const [id, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('Client stopped'));
      this.pendingRequests.delete(id);
    }

    // Clear COV subscriptions
    for (const sub of this.covSubscriptions.values()) {
      if (sub.renewTimer) {
        clearTimeout(sub.renewTimer);
      }
    }
    this.covSubscriptions.clear();

    return new Promise((resolve) => {
      if (this.socket) {
        this.socket.close(() => {
          this.socket = null;
          this.isRunning = false;
          this.emit('disconnected');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Device Discovery
  // ─────────────────────────────────────────────────────────────────────────

  async whoIs(lowLimit?: number, highLimit?: number): Promise<BACnetDevice[]> {
    const encoder = new BACnetEncoder();

    // BVLL Header
    encoder.writeByte(0x81); // BACnet/IP
    encoder.writeByte(BVLLType.ORIGINAL_BROADCAST_NPDU);
    const lengthOffset = encoder.length;
    encoder.writeUInt16BE(0); // Placeholder for length

    // NPDU
    encoder.writeByte(BACNET_PROTOCOL_VERSION);
    encoder.writeByte(0x20); // Network layer message, no reply expected

    // APDU - Unconfirmed Who-Is
    encoder.writeByte(APDUType.UNCONFIRMED_REQUEST);
    encoder.writeByte(UnconfirmedServiceChoice.WHO_IS);

    if (lowLimit !== undefined && highLimit !== undefined) {
      encoder.writeUnsigned(lowLimit, 0);
      encoder.writeUnsigned(highLimit, 1);
    }

    // Update length
    const buffer = encoder.getBuffer();
    buffer.writeUInt16BE(buffer.length, lengthOffset);

    // Send broadcast
    this.sendBroadcast(buffer);

    // Wait for responses
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(Array.from(this.discoveredDevices.values()));
      }, 3000); // Wait 3 seconds for responses
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Property Read/Write
  // ─────────────────────────────────────────────────────────────────────────

  async readProperty(
    deviceAddress: BACnetAddress,
    objectType: BACnetObjectType,
    objectInstance: number,
    propertyId: BACnetPropertyId,
    arrayIndex?: number
  ): Promise<unknown> {
    const invokeId = this.getNextInvokeId();
    const encoder = new BACnetEncoder();

    // BVLL Header
    encoder.writeByte(0x81);
    encoder.writeByte(BVLLType.ORIGINAL_UNICAST_NPDU);
    const lengthOffset = encoder.length;
    encoder.writeUInt16BE(0);

    // NPDU
    encoder.writeByte(BACNET_PROTOCOL_VERSION);
    encoder.writeByte(0x04); // Expecting reply

    // APDU Header
    encoder.writeByte(APDUType.CONFIRMED_REQUEST | (this.config.maxSegmentsAccepted > 0 ? 0x04 : 0));
    encoder.writeByte((this.config.maxSegmentsAccepted << 4) | 0x05); // Max APDU size 1476
    encoder.writeByte(invokeId);
    encoder.writeByte(ConfirmedServiceChoice.READ_PROPERTY);

    // Object Identifier
    encoder.writeObjectId(objectType, objectInstance, 0);

    // Property Identifier
    encoder.writeUnsigned(propertyId, 1);

    // Array Index (optional)
    if (arrayIndex !== undefined) {
      encoder.writeUnsigned(arrayIndex, 2);
    }

    // Update length
    const buffer = encoder.getBuffer();
    buffer.writeUInt16BE(buffer.length, lengthOffset);

    return this.sendConfirmedRequest(deviceAddress, buffer, invokeId);
  }

  async readPropertyMultiple(
    deviceAddress: BACnetAddress,
    properties: Array<{
      objectType: BACnetObjectType;
      objectInstance: number;
      properties: Array<{ propertyId: BACnetPropertyId; arrayIndex?: number }>;
    }>
  ): Promise<unknown[]> {
    const invokeId = this.getNextInvokeId();
    const encoder = new BACnetEncoder();

    // BVLL Header
    encoder.writeByte(0x81);
    encoder.writeByte(BVLLType.ORIGINAL_UNICAST_NPDU);
    const lengthOffset = encoder.length;
    encoder.writeUInt16BE(0);

    // NPDU
    encoder.writeByte(BACNET_PROTOCOL_VERSION);
    encoder.writeByte(0x04);

    // APDU Header
    encoder.writeByte(APDUType.CONFIRMED_REQUEST | 0x04);
    encoder.writeByte((this.config.maxSegmentsAccepted << 4) | 0x05);
    encoder.writeByte(invokeId);
    encoder.writeByte(ConfirmedServiceChoice.READ_PROPERTY_MULTIPLE);

    // List of Read Access Specifications
    for (const spec of properties) {
      encoder.writeObjectId(spec.objectType, spec.objectInstance, 0);
      encoder.writeOpeningTag(1);

      for (const prop of spec.properties) {
        encoder.writeUnsigned(prop.propertyId, 0);
        if (prop.arrayIndex !== undefined) {
          encoder.writeUnsigned(prop.arrayIndex, 1);
        }
      }

      encoder.writeClosingTag(1);
    }

    const buffer = encoder.getBuffer();
    buffer.writeUInt16BE(buffer.length, lengthOffset);

    return this.sendConfirmedRequest(deviceAddress, buffer, invokeId) as Promise<unknown[]>;
  }

  async writeProperty(
    deviceAddress: BACnetAddress,
    objectType: BACnetObjectType,
    objectInstance: number,
    propertyId: BACnetPropertyId,
    value: unknown,
    priority?: number,
    arrayIndex?: number
  ): Promise<void> {
    const invokeId = this.getNextInvokeId();
    const encoder = new BACnetEncoder();

    // BVLL Header
    encoder.writeByte(0x81);
    encoder.writeByte(BVLLType.ORIGINAL_UNICAST_NPDU);
    const lengthOffset = encoder.length;
    encoder.writeUInt16BE(0);

    // NPDU
    encoder.writeByte(BACNET_PROTOCOL_VERSION);
    encoder.writeByte(0x04);

    // APDU Header
    encoder.writeByte(APDUType.CONFIRMED_REQUEST | 0x04);
    encoder.writeByte((this.config.maxSegmentsAccepted << 4) | 0x05);
    encoder.writeByte(invokeId);
    encoder.writeByte(ConfirmedServiceChoice.WRITE_PROPERTY);

    // Object Identifier
    encoder.writeObjectId(objectType, objectInstance, 0);

    // Property Identifier
    encoder.writeUnsigned(propertyId, 1);

    // Array Index (optional)
    if (arrayIndex !== undefined) {
      encoder.writeUnsigned(arrayIndex, 2);
    }

    // Property Value
    encoder.writeOpeningTag(3);
    this.encodeValue(encoder, value);
    encoder.writeClosingTag(3);

    // Priority (optional)
    if (priority !== undefined) {
      encoder.writeUnsigned(priority, 4);
    }

    const buffer = encoder.getBuffer();
    buffer.writeUInt16BE(buffer.length, lengthOffset);

    await this.sendConfirmedRequest(deviceAddress, buffer, invokeId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COV Subscriptions
  // ─────────────────────────────────────────────────────────────────────────

  async subscribeCOV(
    deviceAddress: BACnetAddress,
    objectType: BACnetObjectType,
    objectInstance: number,
    lifetime: number = 3600,
    issueConfirmedNotifications: boolean = true
  ): Promise<void> {
    const invokeId = this.getNextInvokeId();
    const subscriberProcessId = Math.floor(Math.random() * 0xFFFFFFFF);
    const encoder = new BACnetEncoder();

    // BVLL Header
    encoder.writeByte(0x81);
    encoder.writeByte(BVLLType.ORIGINAL_UNICAST_NPDU);
    const lengthOffset = encoder.length;
    encoder.writeUInt16BE(0);

    // NPDU
    encoder.writeByte(BACNET_PROTOCOL_VERSION);
    encoder.writeByte(0x04);

    // APDU Header
    encoder.writeByte(APDUType.CONFIRMED_REQUEST | 0x04);
    encoder.writeByte((this.config.maxSegmentsAccepted << 4) | 0x05);
    encoder.writeByte(invokeId);
    encoder.writeByte(ConfirmedServiceChoice.SUBSCRIBE_COV);

    // Subscriber Process Identifier
    encoder.writeUnsigned(subscriberProcessId, 0);

    // Monitored Object Identifier
    encoder.writeObjectId(objectType, objectInstance, 1);

    // Issue Confirmed Notifications
    encoder.writeBoolean(issueConfirmedNotifications, 2);

    // Lifetime
    encoder.writeUnsigned(lifetime, 3);

    const buffer = encoder.getBuffer();
    buffer.writeUInt16BE(buffer.length, lengthOffset);

    await this.sendConfirmedRequest(deviceAddress, buffer, invokeId);

    // Store subscription
    const subKey = `${objectType}:${objectInstance}`;
    const existing = this.covSubscriptions.get(subKey);
    if (existing?.renewTimer) {
      clearTimeout(existing.renewTimer);
    }

    this.covSubscriptions.set(subKey, {
      deviceId: 0, // Will be set when we know the device
      objectId: { type: objectType, instance: objectInstance },
      subscriberProcessId,
      lifetime,
      renewTimer: setTimeout(() => {
        // Renew subscription before it expires
        this.subscribeCOV(deviceAddress, objectType, objectInstance, lifetime, issueConfirmedNotifications);
      }, (lifetime - 60) * 1000), // Renew 60 seconds before expiry
    });
  }

  async unsubscribeCOV(
    deviceAddress: BACnetAddress,
    objectType: BACnetObjectType,
    objectInstance: number
  ): Promise<void> {
    const subKey = `${objectType}:${objectInstance}`;
    const subscription = this.covSubscriptions.get(subKey);
    if (!subscription) return;

    const invokeId = this.getNextInvokeId();
    const encoder = new BACnetEncoder();

    // BVLL Header
    encoder.writeByte(0x81);
    encoder.writeByte(BVLLType.ORIGINAL_UNICAST_NPDU);
    const lengthOffset = encoder.length;
    encoder.writeUInt16BE(0);

    // NPDU
    encoder.writeByte(BACNET_PROTOCOL_VERSION);
    encoder.writeByte(0x04);

    // APDU Header
    encoder.writeByte(APDUType.CONFIRMED_REQUEST | 0x04);
    encoder.writeByte((this.config.maxSegmentsAccepted << 4) | 0x05);
    encoder.writeByte(invokeId);
    encoder.writeByte(ConfirmedServiceChoice.SUBSCRIBE_COV);

    // Subscriber Process Identifier
    encoder.writeUnsigned(subscription.subscriberProcessId, 0);

    // Monitored Object Identifier
    encoder.writeObjectId(objectType, objectInstance, 1);

    // No lifetime = unsubscribe

    const buffer = encoder.getBuffer();
    buffer.writeUInt16BE(buffer.length, lengthOffset);

    await this.sendConfirmedRequest(deviceAddress, buffer, invokeId);

    // Clear subscription
    if (subscription.renewTimer) {
      clearTimeout(subscription.renewTimer);
    }
    this.covSubscriptions.delete(subKey);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Time Synchronization
  // ─────────────────────────────────────────────────────────────────────────

  timeSynchronize(deviceAddress?: BACnetAddress, utc: boolean = true): void {
    const now = new Date();
    const encoder = new BACnetEncoder();

    // BVLL Header
    encoder.writeByte(0x81);
    encoder.writeByte(deviceAddress ? BVLLType.ORIGINAL_UNICAST_NPDU : BVLLType.ORIGINAL_BROADCAST_NPDU);
    const lengthOffset = encoder.length;
    encoder.writeUInt16BE(0);

    // NPDU
    encoder.writeByte(BACNET_PROTOCOL_VERSION);
    encoder.writeByte(0x20); // Network layer message

    // APDU
    encoder.writeByte(APDUType.UNCONFIRMED_REQUEST);
    encoder.writeByte(utc ? UnconfirmedServiceChoice.UTC_TIME_SYNCHRONIZATION : UnconfirmedServiceChoice.TIME_SYNCHRONIZATION);

    // Date
    encoder.writeTag(10, false, 4); // Application date
    encoder.writeByte(now.getFullYear() - 1900);
    encoder.writeByte(now.getMonth() + 1);
    encoder.writeByte(now.getDate());
    encoder.writeByte(now.getDay() === 0 ? 7 : now.getDay()); // BACnet: Monday=1, Sunday=7

    // Time
    encoder.writeTag(11, false, 4); // Application time
    encoder.writeByte(utc ? now.getUTCHours() : now.getHours());
    encoder.writeByte(utc ? now.getUTCMinutes() : now.getMinutes());
    encoder.writeByte(utc ? now.getUTCSeconds() : now.getSeconds());
    encoder.writeByte(Math.floor((utc ? now.getUTCMilliseconds() : now.getMilliseconds()) / 10));

    const buffer = encoder.getBuffer();
    buffer.writeUInt16BE(buffer.length, lengthOffset);

    if (deviceAddress) {
      this.sendUnicast(deviceAddress, buffer);
    } else {
      this.sendBroadcast(buffer);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Device Information
  // ─────────────────────────────────────────────────────────────────────────

  async getDeviceInfo(deviceAddress: BACnetAddress, deviceInstance: number): Promise<Partial<BACnetDevice>> {
    // Property IDs defined locally to avoid type import issues
    const PROP_OBJECT_NAME = 77;
    const PROP_DESCRIPTION = 28;
    const PROP_VENDOR_ID = 120;
    const PROP_VENDOR_NAME = 121;
    const PROP_MODEL_NAME = 70;
    const PROP_FIRMWARE_REV = 44;
    const PROP_APP_SOFTWARE_VER = 12;
    const PROP_PROTOCOL_VER = 98;
    const PROP_PROTOCOL_REV = 139;
    const PROP_OBJECT_LIST = 76;

    const properties = [
      { propertyId: PROP_OBJECT_NAME },
      { propertyId: PROP_DESCRIPTION },
      { propertyId: PROP_VENDOR_ID },
      { propertyId: PROP_VENDOR_NAME },
      { propertyId: PROP_MODEL_NAME },
      { propertyId: PROP_FIRMWARE_REV },
      { propertyId: PROP_APP_SOFTWARE_VER },
      { propertyId: PROP_PROTOCOL_VER },
      { propertyId: PROP_PROTOCOL_REV },
      { propertyId: PROP_OBJECT_LIST },
    ];

    try {
      const results = await this.readPropertyMultiple(deviceAddress, [{
        objectType: 8, // DEVICE
        objectInstance: deviceInstance,
        properties,
      }]);

      // Parse results into device info
      return this.parseDeviceInfo(results, deviceInstance, deviceAddress);
    } catch {
      // Fall back to individual reads if RPM not supported
      const device: Partial<BACnetDevice> = {
        deviceId: deviceInstance,
        address: deviceAddress,
      };

      for (const prop of properties) {
        try {
          const value = await this.readProperty(
            deviceAddress,
            BACnetObjectType.DEVICE,
            deviceInstance,
            prop.propertyId
          );
          this.setDeviceProperty(device, prop.propertyId, value);
        } catch {
          // Property not supported, continue
        }
      }

      return device;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Convenience Methods for Common Point Types
  // ─────────────────────────────────────────────────────────────────────────

  async readAnalogValue(
    deviceAddress: BACnetAddress,
    instance: number
  ): Promise<{ value: number; units: BACnetEngineeringUnits; status: BACnetStatusFlags }> {
    const results = await this.readPropertyMultiple(deviceAddress, [{
      objectType: BACnetObjectType.ANALOG_VALUE,
      objectInstance: instance,
      properties: [
        { propertyId: BACnetPropertyId.PRESENT_VALUE },
        { propertyId: BACnetPropertyId.UNITS },
        { propertyId: BACnetPropertyId.STATUS_FLAGS },
      ],
    }]);

    return this.parseAnalogResult(results);
  }

  async writeAnalogValue(
    deviceAddress: BACnetAddress,
    instance: number,
    value: number,
    priority?: number
  ): Promise<void> {
    await this.writeProperty(
      deviceAddress,
      BACnetObjectType.ANALOG_VALUE,
      instance,
      BACnetPropertyId.PRESENT_VALUE,
      value,
      priority
    );
  }

  async readBinaryValue(
    deviceAddress: BACnetAddress,
    instance: number
  ): Promise<{ value: boolean; status: BACnetStatusFlags }> {
    const results = await this.readPropertyMultiple(deviceAddress, [{
      objectType: BACnetObjectType.BINARY_VALUE,
      objectInstance: instance,
      properties: [
        { propertyId: BACnetPropertyId.PRESENT_VALUE },
        { propertyId: BACnetPropertyId.STATUS_FLAGS },
      ],
    }]);

    return this.parseBinaryResult(results);
  }

  async writeBinaryValue(
    deviceAddress: BACnetAddress,
    instance: number,
    value: boolean,
    priority?: number
  ): Promise<void> {
    await this.writeProperty(
      deviceAddress,
      BACnetObjectType.BINARY_VALUE,
      instance,
      BACnetPropertyId.PRESENT_VALUE,
      value,
      priority
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────────────────

  private getNextInvokeId(): number {
    this.invokeId = (this.invokeId + 1) & 0xff;
    return this.invokeId;
  }

  private sendBroadcast(buffer: Buffer): void {
    if (!this.socket) throw new Error('Socket not initialized');
    this.socket.send(buffer, 0, buffer.length, this.config.port, this.config.broadcastAddress);
  }

  private sendUnicast(address: BACnetAddress, buffer: Buffer): void {
    if (!this.socket) throw new Error('Socket not initialized');
    if (address.ip) {
      this.socket.send(buffer, 0, buffer.length, address.port || this.config.port, address.ip);
    }
  }

  private sendConfirmedRequest(address: BACnetAddress, buffer: Buffer, invokeId: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(invokeId);
        reject(new Error(`Request timeout (invoke ID: ${invokeId})`));
      }, this.config.apduTimeout);

      this.pendingRequests.set(invokeId, { resolve, reject, timeout });
      this.sendUnicast(address, buffer);
    });
  }

  private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    try {
      const decoder = new BACnetDecoder(msg);

      // BVLL Header
      const bvllType = decoder.readByte();
      if (bvllType !== 0x81) return; // Not BACnet/IP

      const bvllFunction = decoder.readByte();
      const bvllLength = decoder.readUInt16BE();

      // Handle forwarded NPDU
      if (bvllFunction === BVLLType.FORWARDED_NPDU) {
        // Skip original source address
        decoder.skip(6);
      }

      // NPDU
      const npduVersion = decoder.readByte();
      if (npduVersion !== BACNET_PROTOCOL_VERSION) return;

      const npduControl = decoder.readByte();

      // Handle destination/source network info if present
      if (npduControl & 0x20) {
        const dnet = decoder.readUInt16BE();
        const dlen = decoder.readByte();
        if (dlen > 0) {
          decoder.skip(dlen);
        }
      }
      if (npduControl & 0x08) {
        const snet = decoder.readUInt16BE();
        const slen = decoder.readByte();
        if (slen > 0) {
          decoder.skip(slen);
        }
      }
      if (npduControl & 0x20) {
        decoder.skip(1); // Hop count
      }

      // Check if this is a network layer message
      if (npduControl & 0x80) {
        // Network layer message - not handling these for now
        return;
      }

      // APDU
      const apduType = decoder.peekByte() >> 4;

      switch (apduType) {
        case 1: // Unconfirmed request
          this.handleUnconfirmedRequest(decoder, rinfo);
          break;
        case 3: // Complex ACK
          this.handleComplexAck(decoder);
          break;
        case 2: // Simple ACK
          this.handleSimpleAck(decoder);
          break;
        case 5: // Error
          this.handleError(decoder);
          break;
        case 6: // Reject
          this.handleReject(decoder);
          break;
        case 7: // Abort
          this.handleAbort(decoder);
          break;
      }
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleUnconfirmedRequest(decoder: BACnetDecoder, rinfo: dgram.RemoteInfo): void {
    decoder.readByte(); // Skip APDU type byte
    const serviceChoice = decoder.readByte();

    switch (serviceChoice) {
      case UnconfirmedServiceChoice.I_AM:
        this.handleIAm(decoder, rinfo);
        break;
      case UnconfirmedServiceChoice.UNCONFIRMED_COV_NOTIFICATION:
        this.handleCOVNotification(decoder);
        break;
      case UnconfirmedServiceChoice.UNCONFIRMED_EVENT_NOTIFICATION:
        this.handleEventNotification(decoder);
        break;
    }
  }

  private handleIAm(decoder: BACnetDecoder, rinfo: dgram.RemoteInfo): void {
    // Device Object Identifier
    const tag1 = decoder.readTag();
    const deviceId = decoder.readObjectId();

    // Max APDU Length
    const tag2 = decoder.readTag();
    const maxApdu = decoder.readUnsigned(tag2.length);

    // Segmentation Supported
    const tag3 = decoder.readTag();
    const segmentation = decoder.readUnsigned(tag3.length) as BACnetSegmentation;

    // Vendor ID
    const tag4 = decoder.readTag();
    const vendorId = decoder.readUnsigned(tag4.length);

    const device: BACnetDevice = {
      deviceId: deviceId.instance,
      address: {
        ip: rinfo.address,
        port: rinfo.port,
        mac: `${rinfo.address}:${rinfo.port}`,
      },
      name: `Device ${deviceId.instance}`,
      vendorId,
      vendorName: this.getVendorName(vendorId),
      maxApduLengthAccepted: maxApdu,
      segmentationSupported: segmentation,
      servicesSupported: {} as BACnetServicesSupported,
      objectTypesSupported: [],
      objectList: [],
      lastSeen: new Date(),
      status: 'online',
    };

    this.discoveredDevices.set(deviceId.instance, device);
    this.emit('device-discovered', device);
  }

  private handleCOVNotification(decoder: BACnetDecoder): void {
    // Parse COV notification
    const tag1 = decoder.readTag();
    const subscriberProcessId = decoder.readUnsigned(tag1.length);

    const tag2 = decoder.readTag();
    const initiatingDeviceId = decoder.readObjectId();

    const tag3 = decoder.readTag();
    const monitoredObjectId = decoder.readObjectId();

    const tag4 = decoder.readTag();
    const timeRemaining = decoder.readUnsigned(tag4.length);

    // Parse list of values - use Record to allow dynamic property assignment
    const values: Record<string, unknown> = {};
    decoder.readTag(); // Opening tag 4

    while (decoder.remaining > 0) {
      const propTag = decoder.readTag();
      if (propTag.isClosingTag) break;

      const propertyId = decoder.readUnsigned(propTag.length);
      decoder.readTag(); // Opening tag for value

      // Read value based on property
      const value = this.decodeValue(decoder);
      values[this.propertyIdToKey(propertyId)] = value;

      decoder.readTag(); // Closing tag for value
    }

    this.emit('cov-notification', initiatingDeviceId.instance, {
      type: monitoredObjectId.type,
      instance: monitoredObjectId.instance,
    }, values);
  }

  private handleEventNotification(decoder: BACnetDecoder): void {
    // Parse event notification - emit as alarm
    const eventData: Record<string, unknown> = {};
    
    // Skip detailed parsing for now, just emit the raw data
    this.emit('alarm', 0, eventData);
  }

  private handleComplexAck(decoder: BACnetDecoder): void {
    decoder.readByte(); // APDU type
    const invokeId = decoder.readByte();
    const serviceChoice = decoder.readByte();

    const request = this.pendingRequests.get(invokeId);
    if (!request) return;

    clearTimeout(request.timeout);
    this.pendingRequests.delete(invokeId);

    try {
      switch (serviceChoice) {
        case ConfirmedServiceChoice.READ_PROPERTY:
          request.resolve(this.decodeReadPropertyAck(decoder));
          break;
        case ConfirmedServiceChoice.READ_PROPERTY_MULTIPLE:
          request.resolve(this.decodeReadPropertyMultipleAck(decoder));
          break;
        default:
          request.resolve(null);
      }
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleSimpleAck(decoder: BACnetDecoder): void {
    decoder.readByte(); // APDU type
    const invokeId = decoder.readByte();

    const request = this.pendingRequests.get(invokeId);
    if (request) {
      clearTimeout(request.timeout);
      this.pendingRequests.delete(invokeId);
      request.resolve(null);
    }
  }

  private handleError(decoder: BACnetDecoder): void {
    decoder.readByte(); // APDU type
    const invokeId = decoder.readByte();
    const serviceChoice = decoder.readByte();

    const tag1 = decoder.readTag();
    const errorClass = decoder.readUnsigned(tag1.length);
    const tag2 = decoder.readTag();
    const errorCode = decoder.readUnsigned(tag2.length);

    const request = this.pendingRequests.get(invokeId);
    if (request) {
      clearTimeout(request.timeout);
      this.pendingRequests.delete(invokeId);
      request.reject(new Error(`BACnet Error: class=${errorClass}, code=${errorCode}`));
    }
  }

  private handleReject(decoder: BACnetDecoder): void {
    decoder.readByte(); // APDU type
    const invokeId = decoder.readByte();
    const rejectReason = decoder.readByte();

    const request = this.pendingRequests.get(invokeId);
    if (request) {
      clearTimeout(request.timeout);
      this.pendingRequests.delete(invokeId);
      request.reject(new Error(`BACnet Reject: reason=${rejectReason}`));
    }
  }

  private handleAbort(decoder: BACnetDecoder): void {
    decoder.readByte(); // APDU type
    const invokeId = decoder.readByte() & 0x0f;
    const abortReason = decoder.readByte();

    const request = this.pendingRequests.get(invokeId);
    if (request) {
      clearTimeout(request.timeout);
      this.pendingRequests.delete(invokeId);
      request.reject(new Error(`BACnet Abort: reason=${abortReason}`));
    }
  }

  private decodeReadPropertyAck(decoder: BACnetDecoder): unknown {
    // Object Identifier
    const tag1 = decoder.readTag();
    const objectId = decoder.readObjectId();

    // Property Identifier
    const tag2 = decoder.readTag();
    const propertyId = decoder.readUnsigned(tag2.length);

    // Array Index (optional)
    let arrayIndex: number | undefined;
    let tag3 = decoder.readTag();
    if (tag3.tagNumber === 2 && tag3.contextSpecific) {
      arrayIndex = decoder.readUnsigned(tag3.length);
      tag3 = decoder.readTag();
    }

    // Property Value (opening tag 3)
    if (tag3.isOpeningTag && tag3.tagNumber === 3) {
      const value = this.decodeValue(decoder);
      decoder.readTag(); // closing tag
      return value;
    }

    return null;
  }

  private decodeReadPropertyMultipleAck(decoder: BACnetDecoder): unknown[] {
    const results: unknown[] = [];

    while (decoder.remaining > 0) {
      const tag = decoder.readTag();
      if (tag.tagNumber !== 0 || !tag.contextSpecific) break;

      const objectId = decoder.readObjectId();
      const listOfResults: unknown[] = [];

      // Opening tag 1
      decoder.readTag();

      while (true) {
        const propTag = decoder.readTag();
        if (propTag.isClosingTag) break;

        const propertyId = decoder.readUnsigned(propTag.length);

        let arrayIndex: number | undefined;
        let valueOrErrorTag = decoder.readTag();
        if (valueOrErrorTag.tagNumber === 1 && valueOrErrorTag.contextSpecific) {
          arrayIndex = decoder.readUnsigned(valueOrErrorTag.length);
          valueOrErrorTag = decoder.readTag();
        }

        if (valueOrErrorTag.isOpeningTag && valueOrErrorTag.tagNumber === 4) {
          // Property value
          const value = this.decodeValue(decoder);
          listOfResults.push({ propertyId, arrayIndex, value });
          decoder.readTag(); // closing tag
        } else if (valueOrErrorTag.isOpeningTag && valueOrErrorTag.tagNumber === 5) {
          // Property access error
          const errTag1 = decoder.readTag();
          const errorClass = decoder.readUnsigned(errTag1.length);
          const errTag2 = decoder.readTag();
          const errorCode = decoder.readUnsigned(errTag2.length);
          listOfResults.push({ propertyId, arrayIndex, error: { errorClass, errorCode } });
          decoder.readTag(); // closing tag
        }
      }

      results.push({ objectId, properties: listOfResults });
    }

    return results;
  }

  private decodeValue(decoder: BACnetDecoder): unknown {
    const tag = decoder.readTag();

    if (tag.contextSpecific) {
      // Context-specific tag
      switch (tag.tagNumber) {
        case 0: // Opening/constructed
          const constructed: unknown[] = [];
          while (true) {
            const innerTag = decoder.readTag();
            if (innerTag.isClosingTag) break;
            // Put tag back and decode value
            constructed.push(this.decodeValueFromTag(innerTag, decoder));
          }
          return constructed;
        default:
          return decoder.readUnsigned(tag.length);
      }
    }

    return this.decodeValueFromTag(tag, decoder);
  }

  private decodeValueFromTag(tag: ReturnType<BACnetDecoder['readTag']>, decoder: BACnetDecoder): unknown {
    switch (tag.tagNumber) {
      case 0: // Null
        return null;
      case 1: // Boolean
        return tag.length === 1;
      case 2: // Unsigned Integer
        return decoder.readUnsigned(tag.length);
      case 3: // Signed Integer
        return decoder.readUnsigned(tag.length); // TODO: Handle signed
      case 4: // Real
        return decoder.readReal();
      case 5: // Double
        return decoder.readDouble();
      case 6: // Octet String
        return decoder.readBytes(tag.length);
      case 7: // Character String
        return decoder.readString(tag.length);
      case 8: // Bit String
        const unusedBits = decoder.readByte();
        return decoder.readBytes(tag.length - 1);
      case 9: // Enumerated
        return decoder.readUnsigned(tag.length);
      case 10: // Date
        return {
          year: decoder.readByte() + 1900,
          month: decoder.readByte(),
          day: decoder.readByte(),
          dayOfWeek: decoder.readByte(),
        };
      case 11: // Time
        return {
          hour: decoder.readByte(),
          minute: decoder.readByte(),
          second: decoder.readByte(),
          hundredths: decoder.readByte(),
        };
      case 12: // Object Identifier
        return decoder.readObjectId();
      default:
        decoder.skip(tag.length);
        return null;
    }
  }

  private encodeValue(encoder: BACnetEncoder, value: unknown): void {
    if (value === null) {
      encoder.writeByte(0x00); // Null
    } else if (typeof value === 'boolean') {
      encoder.writeBoolean(value);
    } else if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        encoder.writeUnsigned(value);
      } else {
        encoder.writeReal(value);
      }
    } else if (typeof value === 'string') {
      encoder.writeString(value);
    }
  }

  private parseDeviceInfo(results: unknown[], deviceInstance: number, address: BACnetAddress): Partial<BACnetDevice> {
    const device: Partial<BACnetDevice> = {
      deviceId: deviceInstance,
      address,
    };

    // Parse results
    if (Array.isArray(results) && results.length > 0) {
      const props = (results[0] as { properties: Array<{ propertyId: number; value: unknown }> }).properties;
      for (const prop of props) {
        this.setDeviceProperty(device, prop.propertyId, prop.value);
      }
    }

    return device;
  }

  private setDeviceProperty(device: Partial<BACnetDevice>, propertyId: number, value: unknown): void {
    switch (propertyId) {
      case BACnetPropertyId.OBJECT_NAME:
        device.name = value as string;
        break;
      case BACnetPropertyId.DESCRIPTION:
        device.description = value as string;
        break;
      case 120: // vendorId
        device.vendorId = value as number;
        device.vendorName = this.getVendorName(value as number);
        break;
      case 70: // modelName
        device.modelName = value as string;
        break;
      case 44: // firmwareRevision
        device.firmwareRevision = value as string;
        break;
      case 12: // applicationSoftwareVersion
        device.applicationSoftwareVersion = value as string;
        break;
      case 98: // protocolVersion
        device.protocolVersion = value as number;
        break;
      case 139: // protocolRevision
        device.protocolRevision = value as number;
        break;
    }
  }

  private parseAnalogResult(results: unknown[]): { value: number; units: BACnetEngineeringUnits; status: BACnetStatusFlags } {
    let value = 0;
    let units = BACnetEngineeringUnits.NO_UNITS;
    const status: BACnetStatusFlags = { inAlarm: false, fault: false, overridden: false, outOfService: false };

    if (Array.isArray(results) && results.length > 0) {
      const props = (results[0] as { properties: Array<{ propertyId: number; value: unknown }> }).properties;
      for (const prop of props) {
        switch (prop.propertyId) {
          case BACnetPropertyId.PRESENT_VALUE:
            value = prop.value as number;
            break;
          case BACnetPropertyId.UNITS:
            units = prop.value as BACnetEngineeringUnits;
            break;
          case BACnetPropertyId.STATUS_FLAGS:
            // Parse bit string
            if (Buffer.isBuffer(prop.value) && prop.value.length > 0) {
              const flags = prop.value[0];
              status.inAlarm = !!(flags & 0x80);
              status.fault = !!(flags & 0x40);
              status.overridden = !!(flags & 0x20);
              status.outOfService = !!(flags & 0x10);
            }
            break;
        }
      }
    }

    return { value, units, status };
  }

  private parseBinaryResult(results: unknown[]): { value: boolean; status: BACnetStatusFlags } {
    let value = false;
    const status: BACnetStatusFlags = { inAlarm: false, fault: false, overridden: false, outOfService: false };

    if (Array.isArray(results) && results.length > 0) {
      const props = (results[0] as { properties: Array<{ propertyId: number; value: unknown }> }).properties;
      for (const prop of props) {
        switch (prop.propertyId) {
          case BACnetPropertyId.PRESENT_VALUE:
            value = prop.value === 1 || prop.value === true;
            break;
          case BACnetPropertyId.STATUS_FLAGS:
            if (Buffer.isBuffer(prop.value) && prop.value.length > 0) {
              const flags = prop.value[0];
              status.inAlarm = !!(flags & 0x80);
              status.fault = !!(flags & 0x40);
              status.overridden = !!(flags & 0x20);
              status.outOfService = !!(flags & 0x10);
            }
            break;
        }
      }
    }

    return { value, status };
  }

  private propertyIdToKey(propertyId: number): keyof BACnetObject {
    switch (propertyId) {
      case BACnetPropertyId.PRESENT_VALUE: return 'presentValue';
      case BACnetPropertyId.OBJECT_NAME: return 'objectName';
      case BACnetPropertyId.DESCRIPTION: return 'description';
      case BACnetPropertyId.STATUS_FLAGS: return 'statusFlags';
      case BACnetPropertyId.EVENT_STATE: return 'eventState';
      case BACnetPropertyId.RELIABILITY: return 'reliability';
      case BACnetPropertyId.OUT_OF_SERVICE: return 'outOfService';
      case BACnetPropertyId.UNITS: return 'units';
      default: return 'presentValue';
    }
  }

  private getVendorName(vendorId: number): string {
    // Common BACnet vendor IDs
    const vendors: Record<number, string> = {
      2: 'The Trane Company',
      7: 'Automated Logic Corporation',
      15: 'Carrier',
      17: 'Siemens Industry, Inc.',
      24: 'Johnson Controls, Inc.',
      95: 'Honeywell',
      343: 'Trane U.S. Inc.',
      555: 'FreedomForge',
    };
    return vendors[vendorId] || `Vendor ${vendorId}`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Accessors
  // ─────────────────────────────────────────────────────────────────────────

  get devices(): Map<number, BACnetDevice> {
    return this.discoveredDevices;
  }

  get running(): boolean {
    return this.isRunning;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Function
// ─────────────────────────────────────────────────────────────────────────────

export function createBACnetClient(config?: Partial<BACnetClientConfig>): BACnetClient {
  return new BACnetClient({
    localDeviceId: config?.localDeviceId ?? parseInt(process.env.BACNET_DEVICE_ID ?? '999999', 10),
    localIpAddress: config?.localIpAddress ?? process.env.BACNET_LOCAL_IP,
    broadcastAddress: config?.broadcastAddress ?? process.env.BACNET_BROADCAST_ADDRESS,
    port: config?.port ?? parseInt(process.env.BACNET_PORT ?? '47808', 10),
    apduTimeout: config?.apduTimeout ?? parseInt(process.env.BACNET_TIMEOUT ?? '6000', 10),
    ...config,
  });
}
