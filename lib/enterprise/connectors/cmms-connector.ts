/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — CMMS Integration Connector
   
   Enterprise Computerized Maintenance Management System integration
   Supports:
   - IBM Maximo Asset Management
   - ServiceNow Facility Management
   - Generic CMMS REST API interface
   
   Features:
   - Work order creation and management
   - Asset lifecycle tracking
   - Preventive maintenance scheduling
   - Parts and inventory management
   - Labor and cost tracking
   - Integration with building automation alarms
   ═══════════════════════════════════════════════════════════════════════════ */

import { EventEmitter } from 'events';

// ─────────────────────────────────────────────────────────────────────────────
// CMMS Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CMSSAsset {
  id: string;
  assetNum: string;
  description: string;
  assetType: string;
  location: string;
  site: string;
  status: 'active' | 'inactive' | 'decommissioned' | 'pending';
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  installDate?: Date;
  warrantyExpiry?: Date;
  parent?: string;
  children?: string[];
  classification?: string;
  priority?: number;
  criticality?: 'low' | 'medium' | 'high' | 'critical';
  specifications?: Record<string, unknown>;
  customAttributes?: Record<string, unknown>;
  bacnetDeviceId?: number;
  modbusAddress?: number;
  lastModified?: Date;
}

export interface CMSSLocation {
  id: string;
  locationCode: string;
  description: string;
  site: string;
  building?: string;
  floor?: string;
  room?: string;
  type: 'site' | 'building' | 'floor' | 'room' | 'area' | 'equipment_location';
  parent?: string;
  children?: string[];
  address?: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  coordinates?: {
    latitude: number;
    longitude: number;
  };
}

export type CMSSWorkOrderStatus = 
  | 'draft'
  | 'waiting_approval'
  | 'approved'
  | 'assigned'
  | 'in_progress'
  | 'waiting_parts'
  | 'waiting_vendor'
  | 'completed'
  | 'closed'
  | 'cancelled';

export type CMSSWorkOrderType =
  | 'corrective'
  | 'preventive'
  | 'predictive'
  | 'emergency'
  | 'inspection'
  | 'calibration'
  | 'project';

export type CMSSWorkOrderPriority = 1 | 2 | 3 | 4 | 5;

export interface CMSSWorkOrder {
  id: string;
  woNum: string;
  description: string;
  longDescription?: string;
  status: CMSSWorkOrderStatus;
  type: CMSSWorkOrderType;
  priority: CMSSWorkOrderPriority;
  
  // Asset and location
  assetId?: string;
  assetNum?: string;
  locationId?: string;
  locationCode?: string;
  site: string;
  
  // Classification
  problemCode?: string;
  causeCode?: string;
  remedyCode?: string;
  failureClass?: string;
  
  // Scheduling
  reportedDate: Date;
  scheduledStart?: Date;
  scheduledEnd?: Date;
  actualStart?: Date;
  actualEnd?: Date;
  targetCompletionDate?: Date;
  
  // Assignment
  assignedTo?: string;
  assignedCrew?: string;
  supervisor?: string;
  vendor?: string;
  
  // Source
  sourceType: 'manual' | 'alarm' | 'pm_schedule' | 'condition_based' | 'request';
  sourceReference?: string;
  
  // Labor and costs
  estimatedLaborHours?: number;
  actualLaborHours?: number;
  estimatedCost?: number;
  actualCost?: number;
  
  // Parts
  plannedMaterials?: WorkOrderMaterial[];
  usedMaterials?: WorkOrderMaterial[];
  
  // History
  statusHistory?: {
    status: CMSSWorkOrderStatus;
    timestamp: Date;
    changedBy: string;
    notes?: string;
  }[];
  
  // Integration
  externalId?: string;
  externalSystem?: string;
  
  createdBy: string;
  createdDate: Date;
  modifiedBy?: string;
  modifiedDate?: Date;
}

export interface WorkOrderMaterial {
  itemNum: string;
  description: string;
  quantity: number;
  unitCost?: number;
  totalCost?: number;
  storeroom?: string;
  issuedDate?: Date;
}

export interface PreventiveMaintenanceSchedule {
  id: string;
  pmNum: string;
  description: string;
  assetId?: string;
  assetNum?: string;
  locationId?: string;
  locationCode?: string;
  site: string;
  
  // Schedule
  frequency: {
    type: 'time' | 'meter' | 'condition';
    interval?: number;
    unit?: 'days' | 'weeks' | 'months' | 'years' | 'hours' | 'miles' | 'cycles';
    meterName?: string;
    conditionExpression?: string;
  };
  
  leadTime?: number; // days
  lastCompletionDate?: Date;
  nextDueDate?: Date;
  
  // Work details
  jobPlan?: string;
  estimatedLaborHours?: number;
  priority: CMSSWorkOrderPriority;
  
  // Assignment
  crew?: string;
  vendor?: string;
  
  // Control
  active: boolean;
  seasonalControl?: {
    startMonth: number;
    endMonth: number;
  };
  
  // History
  completionHistory?: {
    woNum: string;
    completionDate: Date;
    laborHours: number;
  }[];
}

export interface ServiceRequest {
  id: string;
  ticketNumber: string;
  summary: string;
  description: string;
  status: 'new' | 'acknowledged' | 'assigned' | 'in_progress' | 'resolved' | 'closed';
  priority: CMSSWorkOrderPriority;
  
  // Requester
  requestedBy: string;
  requestedFor?: string;
  contactEmail?: string;
  contactPhone?: string;
  
  // Location
  site: string;
  locationId?: string;
  locationCode?: string;
  
  // Classification
  category: string;
  subcategory?: string;
  
  // Assignment
  assignmentGroup?: string;
  assignedTo?: string;
  
  // Dates
  reportedDate: Date;
  acknowledgedDate?: Date;
  resolvedDate?: Date;
  closedDate?: Date;
  
  // Related
  workOrderId?: string;
  assetId?: string;
  
  // Notes and attachments
  notes?: {
    text: string;
    createdBy: string;
    createdDate: Date;
    type: 'internal' | 'customer';
  }[];
  attachments?: {
    fileName: string;
    url: string;
    size: number;
    mimeType: string;
  }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// CMMS Connector Interface
// ─────────────────────────────────────────────────────────────────────────────

export interface CMSSConnectorConfig {
  type: 'maximo' | 'servicenow' | 'generic';
  baseUrl: string;
  apiKey?: string;
  username?: string;
  password?: string;
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
  timeout?: number;
  retries?: number;
}

export interface CMSSConnector {
  // Connection
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; message?: string }>;
  
  // Assets
  getAsset(assetId: string): Promise<CMSSAsset | null>;
  getAssets(filter?: Partial<CMSSAsset>): Promise<CMSSAsset[]>;
  createAsset(asset: Omit<CMSSAsset, 'id'>): Promise<CMSSAsset>;
  updateAsset(assetId: string, updates: Partial<CMSSAsset>): Promise<CMSSAsset>;
  
  // Locations
  getLocation(locationId: string): Promise<CMSSLocation | null>;
  getLocations(filter?: Partial<CMSSLocation>): Promise<CMSSLocation[]>;
  
  // Work Orders
  getWorkOrder(woId: string): Promise<CMSSWorkOrder | null>;
  getWorkOrders(filter?: Partial<CMSSWorkOrder>): Promise<CMSSWorkOrder[]>;
  createWorkOrder(wo: Omit<CMSSWorkOrder, 'id' | 'woNum'>): Promise<CMSSWorkOrder>;
  updateWorkOrder(woId: string, updates: Partial<CMSSWorkOrder>): Promise<CMSSWorkOrder>;
  closeWorkOrder(woId: string, completionNotes: string): Promise<CMSSWorkOrder>;
  
  // PM Schedules
  getPMSchedule(pmId: string): Promise<PreventiveMaintenanceSchedule | null>;
  getPMSchedules(filter?: Partial<PreventiveMaintenanceSchedule>): Promise<PreventiveMaintenanceSchedule[]>;
  generatePMWorkOrders(): Promise<CMSSWorkOrder[]>;
  
  // Service Requests
  getServiceRequest(requestId: string): Promise<ServiceRequest | null>;
  getServiceRequests(filter?: Partial<ServiceRequest>): Promise<ServiceRequest[]>;
  createServiceRequest(request: Omit<ServiceRequest, 'id' | 'ticketNumber'>): Promise<ServiceRequest>;
  convertToWorkOrder(requestId: string): Promise<CMSSWorkOrder>;
}

// ─────────────────────────────────────────────────────────────────────────────
// IBM Maximo Connector
// ─────────────────────────────────────────────────────────────────────────────

export interface MaximoConfig extends CMSSConnectorConfig {
  type: 'maximo';
  objectStructure?: string;
  apiVersion?: string;
}

export class MaximoConnector extends EventEmitter implements CMSSConnector {
  private config: MaximoConfig;
  private token?: string;
  private tokenExpiry?: Date;

  constructor(config: MaximoConfig) {
    super();
    this.config = {
      ...config,
      objectStructure: config.objectStructure || 'mxapiwo',
      apiVersion: config.apiVersion || 'oslc',
      timeout: config.timeout || 30000,
      retries: config.retries || 3,
    };
  }

  async connect(): Promise<void> {
    await this.authenticate();
    this.emit('connected');
  }

  async disconnect(): Promise<void> {
    this.token = undefined;
    this.tokenExpiry = undefined;
    this.emit('disconnected');
  }

  async healthCheck(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; message?: string }> {
    try {
      await this.authenticate();
      const response = await this.request('GET', '/maximo/oslc/os/mxapioperloc?oslc.pageSize=1');
      return { status: 'healthy' };
    } catch (error) {
      return { 
        status: 'unhealthy', 
        message: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  private async authenticate(): Promise<void> {
    if (this.token && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return;
    }

    // Maximo OIDC/OAuth2 authentication
    if (this.config.clientId && this.config.clientSecret) {
      const tokenUrl = `${this.config.baseUrl}/maximo/oslc/oauth/token`;
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
        }),
      });

      if (!response.ok) {
        throw new Error(`Authentication failed: ${response.statusText}`);
      }

      const data = await response.json();
      this.token = data.access_token;
      this.tokenExpiry = new Date(Date.now() + (data.expires_in - 60) * 1000);
    } else if (this.config.apiKey) {
      this.token = this.config.apiKey;
      this.tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    } else {
      // Basic auth - encode credentials
      this.token = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
      this.tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    await this.authenticate();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (this.config.apiKey) {
      headers['apikey'] = this.token!;
    } else if (this.config.clientId) {
      headers['Authorization'] = `Bearer ${this.token}`;
    } else {
      headers['Authorization'] = `Basic ${this.token}`;
    }

    const url = `${this.config.baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`Maximo API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Asset methods
  async getAsset(assetId: string): Promise<CMSSAsset | null> {
    try {
      const data = await this.request('GET', `/maximo/oslc/os/mxapiasset/${assetId}`);
      return this.mapMaximoAsset(data);
    } catch {
      return null;
    }
  }

  async getAssets(filter?: Partial<CMSSAsset>): Promise<CMSSAsset[]> {
    const params = new URLSearchParams();
    params.set('oslc.pageSize', '100');
    
    if (filter?.site) {
      params.set('oslc.where', `siteid="${filter.site}"`);
    }
    if (filter?.status) {
      const existing = params.get('oslc.where') || '';
      params.set('oslc.where', existing ? `${existing} and status="${filter.status}"` : `status="${filter.status}"`);
    }

    const data = await this.request('GET', `/maximo/oslc/os/mxapiasset?${params.toString()}`) as { member: unknown[] };
    return (data.member || []).map(a => this.mapMaximoAsset(a));
  }

  async createAsset(asset: Omit<CMSSAsset, 'id'>): Promise<CMSSAsset> {
    const maximoAsset = this.mapToMaximoAsset(asset);
    const data = await this.request('POST', '/maximo/oslc/os/mxapiasset', maximoAsset);
    return this.mapMaximoAsset(data);
  }

  async updateAsset(assetId: string, updates: Partial<CMSSAsset>): Promise<CMSSAsset> {
    const maximoUpdates = this.mapToMaximoAsset(updates as CMSSAsset);
    const data = await this.request('POST', `/maximo/oslc/os/mxapiasset/${assetId}`, maximoUpdates);
    return this.mapMaximoAsset(data);
  }

  private mapMaximoAsset(data: unknown): CMSSAsset {
    const d = data as Record<string, unknown>;
    return {
      id: String(d.assetuid || ''),
      assetNum: String(d.assetnum || ''),
      description: String(d.description || ''),
      assetType: String(d.assettype || ''),
      location: String(d.location || ''),
      site: String(d.siteid || ''),
      status: (d.status as string)?.toLowerCase() as CMSSAsset['status'] || 'active',
      manufacturer: d.manufacturer as string,
      model: d.model as string,
      serialNumber: d.serialnum as string,
      installDate: d.installdate ? new Date(d.installdate as string) : undefined,
      warrantyExpiry: d.warrantyexpdate ? new Date(d.warrantyexpdate as string) : undefined,
      parent: d.parent as string,
      classification: d.classstructureid as string,
      priority: d.priority as number,
      criticality: (d.criticality as string)?.toLowerCase() as CMSSAsset['criticality'],
      lastModified: d.changedate ? new Date(d.changedate as string) : undefined,
    };
  }

  private mapToMaximoAsset(asset: Partial<CMSSAsset>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (asset.assetNum) result.assetnum = asset.assetNum;
    if (asset.description) result.description = asset.description;
    if (asset.assetType) result.assettype = asset.assetType;
    if (asset.location) result.location = asset.location;
    if (asset.site) result.siteid = asset.site;
    if (asset.status) result.status = asset.status.toUpperCase();
    if (asset.manufacturer) result.manufacturer = asset.manufacturer;
    if (asset.model) result.model = asset.model;
    if (asset.serialNumber) result.serialnum = asset.serialNumber;
    if (asset.installDate) result.installdate = asset.installDate.toISOString();
    if (asset.warrantyExpiry) result.warrantyexpdate = asset.warrantyExpiry.toISOString();
    if (asset.priority) result.priority = asset.priority;
    return result;
  }

  // Location methods
  async getLocation(locationId: string): Promise<CMSSLocation | null> {
    try {
      const data = await this.request('GET', `/maximo/oslc/os/mxapioperloc/${locationId}`);
      return this.mapMaximoLocation(data);
    } catch {
      return null;
    }
  }

  async getLocations(filter?: Partial<CMSSLocation>): Promise<CMSSLocation[]> {
    const params = new URLSearchParams();
    params.set('oslc.pageSize', '100');
    
    if (filter?.site) {
      params.set('oslc.where', `siteid="${filter.site}"`);
    }

    const data = await this.request('GET', `/maximo/oslc/os/mxapioperloc?${params.toString()}`) as { member: unknown[] };
    return (data.member || []).map(l => this.mapMaximoLocation(l));
  }

  private mapMaximoLocation(data: unknown): CMSSLocation {
    const d = data as Record<string, unknown>;
    return {
      id: String(d.locationsid || ''),
      locationCode: String(d.location || ''),
      description: String(d.description || ''),
      site: String(d.siteid || ''),
      building: d.building as string,
      floor: d.floor as string,
      room: d.room as string,
      type: (d.type as string)?.toLowerCase() as CMSSLocation['type'] || 'equipment_location',
      parent: d.parent as string,
    };
  }

  // Work Order methods
  async getWorkOrder(woId: string): Promise<CMSSWorkOrder | null> {
    try {
      const data = await this.request('GET', `/maximo/oslc/os/mxapiwo/${woId}`);
      return this.mapMaximoWorkOrder(data);
    } catch {
      return null;
    }
  }

  async getWorkOrders(filter?: Partial<CMSSWorkOrder>): Promise<CMSSWorkOrder[]> {
    const params = new URLSearchParams();
    params.set('oslc.pageSize', '100');
    params.set('oslc.orderBy', '-reportdate');
    
    const conditions: string[] = [];
    if (filter?.site) conditions.push(`siteid="${filter.site}"`);
    if (filter?.status) conditions.push(`status="${filter.status.toUpperCase()}"`);
    if (filter?.assetNum) conditions.push(`assetnum="${filter.assetNum}"`);
    
    if (conditions.length > 0) {
      params.set('oslc.where', conditions.join(' and '));
    }

    const data = await this.request('GET', `/maximo/oslc/os/mxapiwo?${params.toString()}`) as { member: unknown[] };
    return (data.member || []).map(wo => this.mapMaximoWorkOrder(wo));
  }

  async createWorkOrder(wo: Omit<CMSSWorkOrder, 'id' | 'woNum'>): Promise<CMSSWorkOrder> {
    const maximoWO = this.mapToMaximoWorkOrder(wo);
    const data = await this.request('POST', '/maximo/oslc/os/mxapiwo', maximoWO);
    return this.mapMaximoWorkOrder(data);
  }

  async updateWorkOrder(woId: string, updates: Partial<CMSSWorkOrder>): Promise<CMSSWorkOrder> {
    const maximoUpdates = this.mapToMaximoWorkOrder(updates as CMSSWorkOrder);
    const data = await this.request('POST', `/maximo/oslc/os/mxapiwo/${woId}`, maximoUpdates);
    return this.mapMaximoWorkOrder(data);
  }

  async closeWorkOrder(woId: string, completionNotes: string): Promise<CMSSWorkOrder> {
    const data = await this.request('POST', `/maximo/oslc/os/mxapiwo/${woId}`, {
      status: 'COMP',
      statusdate: new Date().toISOString(),
      actfinish: new Date().toISOString(),
    });
    return this.mapMaximoWorkOrder(data);
  }

  private mapMaximoWorkOrder(data: unknown): CMSSWorkOrder {
    const d = data as Record<string, unknown>;
    return {
      id: String(d.workorderid || ''),
      woNum: String(d.wonum || ''),
      description: String(d.description || ''),
      longDescription: d.description_longdescription as string,
      status: (d.status as string)?.toLowerCase().replace(' ', '_') as CMSSWorkOrderStatus || 'draft',
      type: (d.worktype as string)?.toLowerCase() as CMSSWorkOrderType || 'corrective',
      priority: ((d.wopriority as number) || 3) as CMSSWorkOrderPriority,
      assetId: d.assetuid as string,
      assetNum: d.assetnum as string,
      locationId: d.locationsid as string,
      locationCode: d.location as string,
      site: String(d.siteid || ''),
      problemCode: d.problemcode as string,
      causeCode: d.causecode as string,
      remedyCode: d.remedycode as string,
      failureClass: d.failurecode as string,
      reportedDate: d.reportdate ? new Date(d.reportdate as string) : new Date(),
      scheduledStart: d.schedstart ? new Date(d.schedstart as string) : undefined,
      scheduledEnd: d.schedfinish ? new Date(d.schedfinish as string) : undefined,
      actualStart: d.actstart ? new Date(d.actstart as string) : undefined,
      actualEnd: d.actfinish ? new Date(d.actfinish as string) : undefined,
      targetCompletionDate: d.targcompdate ? new Date(d.targcompdate as string) : undefined,
      assignedTo: d.lead as string,
      assignedCrew: d.crewid as string,
      supervisor: d.supervisor as string,
      vendor: d.vendor as string,
      sourceType: (d.origrecordid ? 'alarm' : 'manual') as CMSSWorkOrder['sourceType'],
      sourceReference: d.origrecordid as string,
      estimatedLaborHours: d.estlabhrs as number,
      actualLaborHours: d.actlabhrs as number,
      estimatedCost: d.estmatcost as number,
      actualCost: d.actmatcost as number,
      externalId: d.externalrefid as string,
      createdBy: d.changeby as string || 'system',
      createdDate: d.changedate ? new Date(d.changedate as string) : new Date(),
    };
  }

  private mapToMaximoWorkOrder(wo: Partial<CMSSWorkOrder>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (wo.description) result.description = wo.description;
    if (wo.longDescription) result.description_longdescription = wo.longDescription;
    if (wo.status) result.status = wo.status.toUpperCase().replace('_', ' ');
    if (wo.type) result.worktype = wo.type.toUpperCase();
    if (wo.priority) result.wopriority = wo.priority;
    if (wo.assetNum) result.assetnum = wo.assetNum;
    if (wo.locationCode) result.location = wo.locationCode;
    if (wo.site) result.siteid = wo.site;
    if (wo.problemCode) result.problemcode = wo.problemCode;
    if (wo.scheduledStart) result.schedstart = wo.scheduledStart.toISOString();
    if (wo.scheduledEnd) result.schedfinish = wo.scheduledEnd.toISOString();
    if (wo.assignedTo) result.lead = wo.assignedTo;
    if (wo.assignedCrew) result.crewid = wo.assignedCrew;
    if (wo.estimatedLaborHours) result.estlabhrs = wo.estimatedLaborHours;
    return result;
  }

  // PM Schedule methods
  async getPMSchedule(pmId: string): Promise<PreventiveMaintenanceSchedule | null> {
    try {
      const data = await this.request('GET', `/maximo/oslc/os/mxapipm/${pmId}`);
      return this.mapMaximoPM(data);
    } catch {
      return null;
    }
  }

  async getPMSchedules(filter?: Partial<PreventiveMaintenanceSchedule>): Promise<PreventiveMaintenanceSchedule[]> {
    const params = new URLSearchParams();
    params.set('oslc.pageSize', '100');
    
    if (filter?.site) {
      params.set('oslc.where', `siteid="${filter.site}"`);
    }
    if (filter?.active !== undefined) {
      const existing = params.get('oslc.where') || '';
      const statusFilter = filter.active ? 'status="ACTIVE"' : 'status!="ACTIVE"';
      params.set('oslc.where', existing ? `${existing} and ${statusFilter}` : statusFilter);
    }

    const data = await this.request('GET', `/maximo/oslc/os/mxapipm?${params.toString()}`) as { member: unknown[] };
    return (data.member || []).map(pm => this.mapMaximoPM(pm));
  }

  async generatePMWorkOrders(): Promise<CMSSWorkOrder[]> {
    // Trigger PM work order generation
    // This would typically call a Maximo cron task or automation script
    const data = await this.request('POST', '/maximo/oslc/script/GENERATEPMWO', {}) as { workorders: unknown[] };
    return (data.workorders || []).map(wo => this.mapMaximoWorkOrder(wo));
  }

  private mapMaximoPM(data: unknown): PreventiveMaintenanceSchedule {
    const d = data as Record<string, unknown>;
    return {
      id: String(d.pmuid || ''),
      pmNum: String(d.pmnum || ''),
      description: String(d.description || ''),
      assetId: d.assetuid as string,
      assetNum: d.assetnum as string,
      locationId: d.locationsid as string,
      locationCode: d.location as string,
      site: String(d.siteid || ''),
      frequency: {
        type: d.usetargetdate ? 'time' : (d.usemeter ? 'meter' : 'time'),
        interval: d.frequency as number,
        unit: (d.frequnit as string)?.toLowerCase() as PreventiveMaintenanceSchedule['frequency']['unit'],
        meterName: d.metername as string,
      },
      leadTime: d.leadtime as number,
      lastCompletionDate: d.lastcompdate ? new Date(d.lastcompdate as string) : undefined,
      nextDueDate: d.nextdate ? new Date(d.nextdate as string) : undefined,
      jobPlan: d.jpnum as string,
      estimatedLaborHours: d.estlabhrs as number,
      priority: ((d.priority as number) || 3) as CMSSWorkOrderPriority,
      crew: d.crewid as string,
      vendor: d.vendor as string,
      active: d.status === 'ACTIVE',
    };
  }

  // Service Request methods
  async getServiceRequest(requestId: string): Promise<ServiceRequest | null> {
    try {
      const data = await this.request('GET', `/maximo/oslc/os/mxapisr/${requestId}`);
      return this.mapMaximoSR(data);
    } catch {
      return null;
    }
  }

  async getServiceRequests(filter?: Partial<ServiceRequest>): Promise<ServiceRequest[]> {
    const params = new URLSearchParams();
    params.set('oslc.pageSize', '100');
    params.set('oslc.orderBy', '-reportdate');

    const data = await this.request('GET', `/maximo/oslc/os/mxapisr?${params.toString()}`) as { member: unknown[] };
    return (data.member || []).map(sr => this.mapMaximoSR(sr));
  }

  async createServiceRequest(request: Omit<ServiceRequest, 'id' | 'ticketNumber'>): Promise<ServiceRequest> {
    const maximoSR = {
      description: request.summary,
      description_longdescription: request.description,
      status: 'NEW',
      affectedperson: request.requestedBy,
      reportedby: request.requestedBy,
      siteid: request.site,
      location: request.locationCode,
      classstructureid: request.category,
    };
    const data = await this.request('POST', '/maximo/oslc/os/mxapisr', maximoSR);
    return this.mapMaximoSR(data);
  }

  async convertToWorkOrder(requestId: string): Promise<CMSSWorkOrder> {
    const data = await this.request('POST', `/maximo/oslc/os/mxapisr/${requestId}?action=wsmethod:createWOfromSR`, {});
    const result = data as Record<string, unknown>;
    const woId = result.relatedwo;
    const wo = await this.getWorkOrder(woId as string);
    if (!wo) throw new Error('Failed to create work order from service request');
    return wo;
  }

  private mapMaximoSR(data: unknown): ServiceRequest {
    const d = data as Record<string, unknown>;
    return {
      id: String(d.ticketuid || ''),
      ticketNumber: String(d.ticketid || ''),
      summary: String(d.description || ''),
      description: d.description_longdescription as string || '',
      status: (d.status as string)?.toLowerCase().replace(' ', '_') as ServiceRequest['status'] || 'new',
      priority: ((d.reportedpriority as number) || 3) as CMSSWorkOrderPriority,
      requestedBy: d.affectedperson as string || '',
      requestedFor: d.reportedby as string,
      contactEmail: d.affectedemail as string,
      contactPhone: d.affectedphone as string,
      site: String(d.siteid || ''),
      locationId: d.locationsid as string,
      locationCode: d.location as string,
      category: d.classstructureid as string || 'general',
      assignmentGroup: d.ownergroup as string,
      assignedTo: d.owner as string,
      reportedDate: d.reportdate ? new Date(d.reportdate as string) : new Date(),
      workOrderId: d.relatedwo as string,
      assetId: d.assetuid as string,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ServiceNow Connector
// ─────────────────────────────────────────────────────────────────────────────

export interface ServiceNowConfig extends CMSSConnectorConfig {
  type: 'servicenow';
  instance: string;
  facilityTable?: string;
  workOrderTable?: string;
}

export class ServiceNowConnector extends EventEmitter implements CMSSConnector {
  private config: ServiceNowConfig;
  private token?: string;
  private tokenExpiry?: Date;

  constructor(config: ServiceNowConfig) {
    super();
    this.config = {
      ...config,
      facilityTable: config.facilityTable || 'fm_asset',
      workOrderTable: config.workOrderTable || 'wm_order',
      timeout: config.timeout || 30000,
      retries: config.retries || 3,
    };
  }

  async connect(): Promise<void> {
    await this.authenticate();
    this.emit('connected');
  }

  async disconnect(): Promise<void> {
    this.token = undefined;
    this.tokenExpiry = undefined;
    this.emit('disconnected');
  }

  async healthCheck(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; message?: string }> {
    try {
      await this.authenticate();
      await this.request('GET', '/api/now/table/sys_user?sysparm_limit=1');
      return { status: 'healthy' };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async authenticate(): Promise<void> {
    if (this.token && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return;
    }

    if (this.config.clientId && this.config.clientSecret) {
      const tokenUrl = `https://${this.config.instance}.service-now.com/oauth_token.do`;
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
        }),
      });

      if (!response.ok) {
        throw new Error(`ServiceNow authentication failed: ${response.statusText}`);
      }

      const data = await response.json();
      this.token = data.access_token;
      this.tokenExpiry = new Date(Date.now() + (data.expires_in - 60) * 1000);
    } else {
      // Basic auth
      this.token = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
      this.tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    await this.authenticate();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (this.config.clientId) {
      headers['Authorization'] = `Bearer ${this.token}`;
    } else {
      headers['Authorization'] = `Basic ${this.token}`;
    }

    const url = `https://${this.config.instance}.service-now.com${path}`;
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`ServiceNow API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Implement CMSSConnector interface methods
  // These would follow similar patterns to Maximo but use ServiceNow's REST API

  async getAsset(assetId: string): Promise<CMSSAsset | null> {
    try {
      const data = await this.request('GET', `/api/now/table/${this.config.facilityTable}/${assetId}`);
      return this.mapServiceNowAsset((data as { result: unknown }).result);
    } catch {
      return null;
    }
  }

  async getAssets(filter?: Partial<CMSSAsset>): Promise<CMSSAsset[]> {
    const params = new URLSearchParams();
    params.set('sysparm_limit', '100');
    
    if (filter?.site) {
      params.set('sysparm_query', `location.name=${filter.site}`);
    }

    const data = await this.request('GET', `/api/now/table/${this.config.facilityTable}?${params.toString()}`);
    return ((data as { result: unknown[] }).result || []).map(a => this.mapServiceNowAsset(a));
  }

  async createAsset(asset: Omit<CMSSAsset, 'id'>): Promise<CMSSAsset> {
    const snAsset = this.mapToServiceNowAsset(asset);
    const data = await this.request('POST', `/api/now/table/${this.config.facilityTable}`, snAsset);
    return this.mapServiceNowAsset((data as { result: unknown }).result);
  }

  async updateAsset(assetId: string, updates: Partial<CMSSAsset>): Promise<CMSSAsset> {
    const snUpdates = this.mapToServiceNowAsset(updates as CMSSAsset);
    const data = await this.request('PATCH', `/api/now/table/${this.config.facilityTable}/${assetId}`, snUpdates);
    return this.mapServiceNowAsset((data as { result: unknown }).result);
  }

  private mapServiceNowAsset(data: unknown): CMSSAsset {
    const d = data as Record<string, unknown>;
    return {
      id: String(d.sys_id || ''),
      assetNum: String(d.asset_tag || d.display_name || ''),
      description: String(d.short_description || ''),
      assetType: String(d.model_category || ''),
      location: String((d.location as Record<string, string>)?.display_value || d.location || ''),
      site: String((d.building as Record<string, string>)?.display_value || ''),
      status: (d.install_status as string) === '1' ? 'active' : 'inactive',
      manufacturer: (d.manufacturer as Record<string, string>)?.display_value,
      model: (d.model as Record<string, string>)?.display_value,
      serialNumber: d.serial_number as string,
      installDate: d.install_date ? new Date(d.install_date as string) : undefined,
      warrantyExpiry: d.warranty_expiration ? new Date(d.warranty_expiration as string) : undefined,
    };
  }

  private mapToServiceNowAsset(asset: Partial<CMSSAsset>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (asset.assetNum) result.asset_tag = asset.assetNum;
    if (asset.description) result.short_description = asset.description;
    if (asset.serialNumber) result.serial_number = asset.serialNumber;
    if (asset.status) result.install_status = asset.status === 'active' ? '1' : '0';
    return result;
  }

  async getLocation(locationId: string): Promise<CMSSLocation | null> {
    try {
      const data = await this.request('GET', `/api/now/table/cmn_location/${locationId}`);
      return this.mapServiceNowLocation((data as { result: unknown }).result);
    } catch {
      return null;
    }
  }

  async getLocations(filter?: Partial<CMSSLocation>): Promise<CMSSLocation[]> {
    const data = await this.request('GET', '/api/now/table/cmn_location?sysparm_limit=100');
    return ((data as { result: unknown[] }).result || []).map(l => this.mapServiceNowLocation(l));
  }

  private mapServiceNowLocation(data: unknown): CMSSLocation {
    const d = data as Record<string, unknown>;
    return {
      id: String(d.sys_id || ''),
      locationCode: String(d.name || ''),
      description: String(d.name || ''),
      site: String((d.parent as Record<string, string>)?.display_value || ''),
      type: 'equipment_location',
    };
  }

  async getWorkOrder(woId: string): Promise<CMSSWorkOrder | null> {
    try {
      const data = await this.request('GET', `/api/now/table/${this.config.workOrderTable}/${woId}`);
      return this.mapServiceNowWorkOrder((data as { result: unknown }).result);
    } catch {
      return null;
    }
  }

  async getWorkOrders(filter?: Partial<CMSSWorkOrder>): Promise<CMSSWorkOrder[]> {
    const params = new URLSearchParams();
    params.set('sysparm_limit', '100');
    params.set('sysparm_order_by', 'sys_created_on');
    params.set('sysparm_order_dir', 'desc');

    const data = await this.request('GET', `/api/now/table/${this.config.workOrderTable}?${params.toString()}`);
    return ((data as { result: unknown[] }).result || []).map(wo => this.mapServiceNowWorkOrder(wo));
  }

  async createWorkOrder(wo: Omit<CMSSWorkOrder, 'id' | 'woNum'>): Promise<CMSSWorkOrder> {
    const snWO = this.mapToServiceNowWorkOrder(wo);
    const data = await this.request('POST', `/api/now/table/${this.config.workOrderTable}`, snWO);
    return this.mapServiceNowWorkOrder((data as { result: unknown }).result);
  }

  async updateWorkOrder(woId: string, updates: Partial<CMSSWorkOrder>): Promise<CMSSWorkOrder> {
    const snUpdates = this.mapToServiceNowWorkOrder(updates as CMSSWorkOrder);
    const data = await this.request('PATCH', `/api/now/table/${this.config.workOrderTable}/${woId}`, snUpdates);
    return this.mapServiceNowWorkOrder((data as { result: unknown }).result);
  }

  async closeWorkOrder(woId: string, completionNotes: string): Promise<CMSSWorkOrder> {
    const data = await this.request('PATCH', `/api/now/table/${this.config.workOrderTable}/${woId}`, {
      state: '3', // Closed Complete
      work_notes: completionNotes,
      closed_at: new Date().toISOString(),
    });
    return this.mapServiceNowWorkOrder((data as { result: unknown }).result);
  }

  private mapServiceNowWorkOrder(data: unknown): CMSSWorkOrder {
    const d = data as Record<string, unknown>;
    const stateMap: Record<string, CMSSWorkOrderStatus> = {
      '1': 'draft',
      '2': 'in_progress',
      '3': 'completed',
      '4': 'cancelled',
    };
    return {
      id: String(d.sys_id || ''),
      woNum: String(d.number || ''),
      description: String(d.short_description || ''),
      longDescription: d.description as string,
      status: stateMap[d.state as string] || 'draft',
      type: 'corrective',
      priority: (parseInt(d.priority as string) || 3) as CMSSWorkOrderPriority,
      site: String((d.location as Record<string, string>)?.display_value || ''),
      locationCode: String((d.location as Record<string, string>)?.display_value || ''),
      reportedDate: d.sys_created_on ? new Date(d.sys_created_on as string) : new Date(),
      scheduledStart: d.expected_start ? new Date(d.expected_start as string) : undefined,
      actualStart: d.work_start ? new Date(d.work_start as string) : undefined,
      actualEnd: d.work_end ? new Date(d.work_end as string) : undefined,
      assignedTo: (d.assigned_to as Record<string, string>)?.display_value,
      sourceType: 'manual',
      createdBy: (d.sys_created_by as string) || 'system',
      createdDate: d.sys_created_on ? new Date(d.sys_created_on as string) : new Date(),
    };
  }

  private mapToServiceNowWorkOrder(wo: Partial<CMSSWorkOrder>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (wo.description) result.short_description = wo.description;
    if (wo.longDescription) result.description = wo.longDescription;
    if (wo.priority) result.priority = String(wo.priority);
    if (wo.scheduledStart) result.expected_start = wo.scheduledStart.toISOString();
    return result;
  }

  async getPMSchedule(pmId: string): Promise<PreventiveMaintenanceSchedule | null> {
    // ServiceNow PM schedules would be in a different table
    return null;
  }

  async getPMSchedules(filter?: Partial<PreventiveMaintenanceSchedule>): Promise<PreventiveMaintenanceSchedule[]> {
    return [];
  }

  async generatePMWorkOrders(): Promise<CMSSWorkOrder[]> {
    return [];
  }

  async getServiceRequest(requestId: string): Promise<ServiceRequest | null> {
    try {
      const data = await this.request('GET', `/api/now/table/sc_request/${requestId}`);
      return this.mapServiceNowSR((data as { result: unknown }).result);
    } catch {
      return null;
    }
  }

  async getServiceRequests(filter?: Partial<ServiceRequest>): Promise<ServiceRequest[]> {
    const data = await this.request('GET', '/api/now/table/sc_request?sysparm_limit=100');
    return ((data as { result: unknown[] }).result || []).map(sr => this.mapServiceNowSR(sr));
  }

  async createServiceRequest(request: Omit<ServiceRequest, 'id' | 'ticketNumber'>): Promise<ServiceRequest> {
    const snSR = {
      short_description: request.summary,
      description: request.description,
      requested_by: request.requestedBy,
      priority: String(request.priority),
    };
    const data = await this.request('POST', '/api/now/table/sc_request', snSR);
    return this.mapServiceNowSR((data as { result: unknown }).result);
  }

  async convertToWorkOrder(requestId: string): Promise<CMSSWorkOrder> {
    // Create work order from service request
    const sr = await this.getServiceRequest(requestId);
    if (!sr) throw new Error('Service request not found');
    
    return this.createWorkOrder({
      description: sr.summary,
      longDescription: sr.description,
      status: 'draft',
      type: 'corrective',
      priority: sr.priority,
      site: sr.site,
      locationCode: sr.locationCode,
      reportedDate: sr.reportedDate,
      sourceType: 'request',
      sourceReference: sr.ticketNumber,
      createdBy: 'system',
      createdDate: new Date(),
    });
  }

  private mapServiceNowSR(data: unknown): ServiceRequest {
    const d = data as Record<string, unknown>;
    return {
      id: String(d.sys_id || ''),
      ticketNumber: String(d.number || ''),
      summary: String(d.short_description || ''),
      description: String(d.description || ''),
      status: 'new',
      priority: (parseInt(d.priority as string) || 3) as CMSSWorkOrderPriority,
      requestedBy: (d.requested_by as Record<string, string>)?.display_value || '',
      site: '',
      category: 'general',
      reportedDate: d.sys_created_on ? new Date(d.sys_created_on as string) : new Date(),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Function
// ─────────────────────────────────────────────────────────────────────────────

export function createCMSSConnector(config: CMSSConnectorConfig): CMSSConnector {
  switch (config.type) {
    case 'maximo':
      return new MaximoConnector(config as MaximoConfig);
    case 'servicenow':
      return new ServiceNowConnector(config as ServiceNowConfig);
    default:
      throw new Error(`Unsupported CMMS type: ${config.type}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Alarm-to-Work-Order Integration
// ─────────────────────────────────────────────────────────────────────────────

export interface AlarmWorkOrderConfig {
  enabled: boolean;
  connector: CMSSConnector;
  site: string;
  defaultPriority: CMSSWorkOrderPriority;
  defaultWorkType: CMSSWorkOrderType;
  severityMapping: Record<string, CMSSWorkOrderPriority>;
  autoCreateFor: string[]; // Alarm types to auto-create WOs for
  deduplicationWindow: number; // seconds
}

export class AlarmToWorkOrderIntegration extends EventEmitter {
  private config: AlarmWorkOrderConfig;
  private recentAlarms: Map<string, Date> = new Map();

  constructor(config: AlarmWorkOrderConfig) {
    super();
    this.config = config;
  }

  /**
   * Process an alarm and optionally create a work order
   */
  async processAlarm(alarm: {
    id: string;
    type: string;
    severity: string;
    message: string;
    equipmentId: string;
    equipmentName: string;
    assetNum?: string;
    locationCode?: string;
    timestamp: Date;
  }): Promise<CMSSWorkOrder | null> {
    if (!this.config.enabled) return null;
    if (!this.config.autoCreateFor.includes(alarm.type)) return null;

    // Deduplication check
    const alarmKey = `${alarm.equipmentId}:${alarm.type}`;
    const lastAlarm = this.recentAlarms.get(alarmKey);
    if (lastAlarm) {
      const elapsed = (alarm.timestamp.getTime() - lastAlarm.getTime()) / 1000;
      if (elapsed < this.config.deduplicationWindow) {
        return null;
      }
    }
    this.recentAlarms.set(alarmKey, alarm.timestamp);

    // Create work order
    const priority = this.config.severityMapping[alarm.severity] || this.config.defaultPriority;
    
    try {
      const wo = await this.config.connector.createWorkOrder({
        description: `[AUTO] ${alarm.message}`,
        longDescription: `Automatically created from BAS alarm.\n\nAlarm Details:\n- Type: ${alarm.type}\n- Severity: ${alarm.severity}\n- Equipment: ${alarm.equipmentName}\n- Time: ${alarm.timestamp.toISOString()}`,
        status: 'draft',
        type: this.config.defaultWorkType,
        priority,
        site: this.config.site,
        assetNum: alarm.assetNum,
        locationCode: alarm.locationCode,
        sourceType: 'alarm',
        sourceReference: alarm.id,
        reportedDate: alarm.timestamp,
        createdBy: 'system',
        createdDate: new Date(),
      });

      this.emit('work-order-created', wo, alarm);
      return wo;
    } catch (error) {
      this.emit('error', error);
      return null;
    }
  }

  /**
   * Clear old entries from deduplication cache
   */
  clearOldEntries(): void {
    const cutoff = Date.now() - this.config.deduplicationWindow * 1000;
    for (const [key, timestamp] of this.recentAlarms) {
      if (timestamp.getTime() < cutoff) {
        this.recentAlarms.delete(key);
      }
    }
  }
}
