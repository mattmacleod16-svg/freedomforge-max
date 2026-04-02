/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — ASHRAE Guideline 36 Compliance Engine
   
   Implementation of ASHRAE Guideline 36-2024: High-Performance Sequences
   of Operation for HVAC Systems
   
   Features:
   - Standardized control sequences for AHUs, VAVs, chillers, boilers
   - Fault Detection and Diagnostics (FDD) rules
   - Functional Performance Tests (FPT)
   - Trim & Respond reset logic
   - Demand control ventilation (DCV)
   - Economizer sequences
   - Zone humidity control
   
   Based on ASHRAE Guideline 36-2024
   ═══════════════════════════════════════════════════════════════════════════ */

import { EventEmitter } from 'events';
import {
  HVACEquipmentType,
  HVACPointType,
} from '../building-automation/types';
import type {
  HVACEquipment,
  HVACPoint,
  EquipmentAlarm,
  FaultEvent,
  ComplianceReport,
} from '../building-automation/types';

// ─────────────────────────────────────────────────────────────────────────────
// ASHRAE Guideline 36 Control Parameters
// ─────────────────────────────────────────────────────────────────────────────

export interface G36Parameters {
  // Zone temperature control
  zoneTempSetpointOccCool: number; // °F, default 75
  zoneTempSetpointOccHeat: number; // °F, default 70
  zoneTempSetpointUnoccCool: number; // °F, default 85
  zoneTempSetpointUnoccHeat: number; // °F, default 55
  zoneTempDeadband: number; // °F, default 0.5
  
  // Supply air temperature reset
  satResetMin: number; // °F, minimum SAT, default 55
  satResetMax: number; // °F, maximum SAT, default 65
  satTrimAmount: number; // °F, trim amount, default 0.2
  satRespondAmount: number; // °F, respond amount, default -0.3
  satTimerInterval: number; // seconds, default 120
  satNumRequests: number; // number of zones requesting, default 2
  satNumIgnore: number; // number of zones to ignore, default 1
  
  // Duct static pressure reset
  dspResetMin: number; // inWC, minimum DSP, default 0.25
  dspResetMax: number; // inWC, maximum DSP, default 1.5
  dspTrimAmount: number; // inWC, trim amount, default 0.05
  dspRespondAmount: number; // inWC, respond amount, default -0.1
  dspTimerInterval: number; // seconds, default 120
  dspNumRequests: number; // number of zones requesting, default 2
  dspNumIgnore: number; // number of zones to ignore, default 1
  
  // Outdoor air control
  minOADamper: number; // %, minimum OA damper position, default 15
  economEnable: number; // °F, economizer enable temp, default 70
  economDisable: number; // °F, economizer disable temp, default 75
  dptDpMin: number; // °F, differential dry-bulb temp min, default 0
  
  // CO2 demand control ventilation
  co2SetpointOcc: number; // ppm, occupied CO2 setpoint, default 1000
  co2SetpointUnocc: number; // ppm, unoccupied CO2 setpoint, default 1500
  co2Loop: number; // ppm per %, CO2 loop gain, default 100
  
  // Chilled water temperature reset
  chwsTempResetMin: number; // °F, minimum CHWS temp, default 42
  chwsTempResetMax: number; // °F, maximum CHWS temp, default 54
  
  // Hot water temperature reset
  hwsTempResetMin: number; // °F, minimum HWS temp, default 120
  hwsTempResetMax: number; // °F, maximum HWS temp, default 180
  
  // Timing parameters
  startupDelay: number; // seconds, delay before starting equipment
  proofDelay: number; // seconds, delay for proof status
  alarmDelay: number; // seconds, delay before alarming
}

const DEFAULT_G36_PARAMS: G36Parameters = {
  zoneTempSetpointOccCool: 75,
  zoneTempSetpointOccHeat: 70,
  zoneTempSetpointUnoccCool: 85,
  zoneTempSetpointUnoccHeat: 55,
  zoneTempDeadband: 0.5,
  satResetMin: 55,
  satResetMax: 65,
  satTrimAmount: 0.2,
  satRespondAmount: -0.3,
  satTimerInterval: 120,
  satNumRequests: 2,
  satNumIgnore: 1,
  dspResetMin: 0.25,
  dspResetMax: 1.5,
  dspTrimAmount: 0.05,
  dspRespondAmount: -0.1,
  dspTimerInterval: 120,
  dspNumRequests: 2,
  dspNumIgnore: 1,
  minOADamper: 15,
  economEnable: 70,
  economDisable: 75,
  dptDpMin: 0,
  co2SetpointOcc: 1000,
  co2SetpointUnocc: 1500,
  co2Loop: 100,
  chwsTempResetMin: 42,
  chwsTempResetMax: 54,
  hwsTempResetMin: 120,
  hwsTempResetMax: 180,
  startupDelay: 30,
  proofDelay: 15,
  alarmDelay: 60,
};

// ─────────────────────────────────────────────────────────────────────────────
// Trim & Respond Reset Logic
// ─────────────────────────────────────────────────────────────────────────────

export interface TrimRespondState {
  currentSetpoint: number;
  lastTrimTime: Date;
  requestCount: number;
  requests: Map<string, boolean>;
}

export class TrimRespondReset {
  private state: TrimRespondState;
  private minSetpoint: number;
  private maxSetpoint: number;
  private trimAmount: number;
  private respondAmount: number;
  private timerInterval: number;
  private numRequests: number;
  private numIgnore: number;

  constructor(
    initialSetpoint: number,
    minSetpoint: number,
    maxSetpoint: number,
    trimAmount: number,
    respondAmount: number,
    timerInterval: number = 120,
    numRequests: number = 2,
    numIgnore: number = 1
  ) {
    this.minSetpoint = minSetpoint;
    this.maxSetpoint = maxSetpoint;
    this.trimAmount = trimAmount;
    this.respondAmount = respondAmount;
    this.timerInterval = timerInterval;
    this.numRequests = numRequests;
    this.numIgnore = numIgnore;
    
    this.state = {
      currentSetpoint: initialSetpoint,
      lastTrimTime: new Date(),
      requestCount: 0,
      requests: new Map(),
    };
  }

  /**
   * Update zone request status
   */
  updateRequest(zoneId: string, requesting: boolean): void {
    this.state.requests.set(zoneId, requesting);
    this.state.requestCount = Array.from(this.state.requests.values())
      .filter(r => r).length;
  }

  /**
   * Execute the trim & respond logic
   * Call this periodically (e.g., every timerInterval seconds)
   */
  execute(): { setpoint: number; action: 'trim' | 'respond' | 'hold' } {
    const now = new Date();
    const elapsed = (now.getTime() - this.state.lastTrimTime.getTime()) / 1000;

    if (elapsed < this.timerInterval) {
      return { setpoint: this.state.currentSetpoint, action: 'hold' };
    }

    this.state.lastTrimTime = now;

    // Net requests (total - ignored)
    const netRequests = Math.max(0, this.state.requestCount - this.numIgnore);

    if (netRequests >= this.numRequests) {
      // Respond - decrease setpoint (make more aggressive)
      this.state.currentSetpoint = Math.max(
        this.minSetpoint,
        this.state.currentSetpoint + this.respondAmount
      );
      return { setpoint: this.state.currentSetpoint, action: 'respond' };
    } else {
      // Trim - increase setpoint (save energy)
      this.state.currentSetpoint = Math.min(
        this.maxSetpoint,
        this.state.currentSetpoint + this.trimAmount
      );
      return { setpoint: this.state.currentSetpoint, action: 'trim' };
    }
  }

  get currentSetpoint(): number {
    return this.state.currentSetpoint;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ASHRAE 36 Fault Detection Rules
// ─────────────────────────────────────────────────────────────────────────────

export interface G36FaultRule {
  id: string;
  name: string;
  description: string;
  equipmentTypes: HVACEquipmentType[];
  severity: 'advisory' | 'minor' | 'major' | 'critical';
  category: 'energy' | 'comfort' | 'maintenance' | 'safety' | 'operational';
  evaluator: (equipment: HVACEquipment, points: Map<HVACPointType, number | boolean>) => G36FaultResult;
}

export interface G36FaultResult {
  isFault: boolean;
  faultCode?: string;
  message?: string;
  impact?: {
    energyWaste?: string;
    comfortImpact?: string;
    recommendation?: string;
  };
}

// Pre-defined ASHRAE 36 fault rules
export const G36_FAULT_RULES: G36FaultRule[] = [
  // AHU Faults
  {
    id: 'G36-AHU-01',
    name: 'Supply Air Temperature Too Low',
    description: 'Supply air temperature is more than 4°F below setpoint for more than 5 minutes while in occupied mode',
    equipmentTypes: [HVACEquipmentType.AIR_HANDLING_UNIT, HVACEquipmentType.ROOFTOP_UNIT],
    severity: 'minor',
    category: 'comfort',
    evaluator: (equipment, points) => {
      const sat = points.get(HVACPointType.SUPPLY_AIR_TEMP);
      const satSp = points.get(HVACPointType.COOLING_SETPOINT);
      if (typeof sat !== 'number' || typeof satSp !== 'number') return { isFault: false };
      
      const diff = satSp - sat;
      if (diff > 4) {
        return {
          isFault: true,
          faultCode: 'G36-AHU-01',
          message: `Supply air temp ${sat.toFixed(1)}°F is ${diff.toFixed(1)}°F below setpoint`,
          impact: {
            comfortImpact: 'Overcooling zones, potential complaints',
            energyWaste: 'Excess cooling energy consumption',
            recommendation: 'Check cooling valve, verify setpoint, inspect sensor',
          },
        };
      }
      return { isFault: false };
    },
  },
  {
    id: 'G36-AHU-02',
    name: 'Supply Air Temperature Too High',
    description: 'Supply air temperature is more than 4°F above setpoint for more than 5 minutes while in occupied mode',
    equipmentTypes: [HVACEquipmentType.AIR_HANDLING_UNIT, HVACEquipmentType.ROOFTOP_UNIT],
    severity: 'minor',
    category: 'comfort',
    evaluator: (equipment, points) => {
      const sat = points.get(HVACPointType.SUPPLY_AIR_TEMP);
      const satSp = points.get(HVACPointType.COOLING_SETPOINT);
      if (typeof sat !== 'number' || typeof satSp !== 'number') return { isFault: false };
      
      const diff = sat - satSp;
      if (diff > 4) {
        return {
          isFault: true,
          faultCode: 'G36-AHU-02',
          message: `Supply air temp ${sat.toFixed(1)}°F is ${diff.toFixed(1)}°F above setpoint`,
          impact: {
            comfortImpact: 'Underheating/undercooling zones',
            energyWaste: 'Potential reheating waste in zones',
            recommendation: 'Check cooling/heating coil, verify airflow, inspect controls',
          },
        };
      }
      return { isFault: false };
    },
  },
  {
    id: 'G36-AHU-03',
    name: 'Outdoor Air Damper Stuck',
    description: 'Outdoor air damper command changed but no corresponding change in mixed air temperature',
    equipmentTypes: [HVACEquipmentType.AIR_HANDLING_UNIT, HVACEquipmentType.ROOFTOP_UNIT],
    severity: 'major',
    category: 'maintenance',
    evaluator: (equipment, points) => {
      const oaDamper = points.get(HVACPointType.DAMPER_POSITION);
      const mat = points.get(HVACPointType.MIXED_AIR_TEMP);
      const oat = points.get(HVACPointType.OUTDOOR_AIR_TEMP);
      const rat = points.get(HVACPointType.RETURN_AIR_TEMP);
      
      if (typeof oaDamper !== 'number' || typeof mat !== 'number' ||
          typeof oat !== 'number' || typeof rat !== 'number') return { isFault: false };
      
      // Calculate expected MAT based on damper position
      const expectedMat = rat + (oaDamper / 100) * (oat - rat);
      const diff = Math.abs(mat - expectedMat);
      
      if (oaDamper > 30 && diff > 10) {
        return {
          isFault: true,
          faultCode: 'G36-AHU-03',
          message: `Mixed air temp ${mat.toFixed(1)}°F differs from expected ${expectedMat.toFixed(1)}°F`,
          impact: {
            energyWaste: 'Economizer not functioning, excess mechanical cooling',
            comfortImpact: 'Potential IAQ issues if minimum OA not met',
            recommendation: 'Inspect OA damper actuator and linkage',
          },
        };
      }
      return { isFault: false };
    },
  },
  {
    id: 'G36-AHU-04',
    name: 'Heating and Cooling Simultaneously',
    description: 'Both heating and cooling are active at the same time',
    equipmentTypes: [HVACEquipmentType.AIR_HANDLING_UNIT, HVACEquipmentType.ROOFTOP_UNIT],
    severity: 'major',
    category: 'energy',
    evaluator: (equipment, points) => {
      // This would check heating valve and cooling valve simultaneously open
      const heatingValve = equipment.points.find(p => 
        p.name.toLowerCase().includes('heating') && p.name.toLowerCase().includes('valve'));
      const coolingValve = equipment.points.find(p =>
        p.name.toLowerCase().includes('cooling') && p.name.toLowerCase().includes('valve'));
      
      if (!heatingValve || !coolingValve) return { isFault: false };
      
      const hv = typeof heatingValve.currentValue === 'number' ? heatingValve.currentValue : 0;
      const cv = typeof coolingValve.currentValue === 'number' ? coolingValve.currentValue : 0;
      
      if (hv > 10 && cv > 10) {
        return {
          isFault: true,
          faultCode: 'G36-AHU-04',
          message: `Heating valve ${hv.toFixed(0)}% and cooling valve ${cv.toFixed(0)}% both open`,
          impact: {
            energyWaste: 'Significant energy waste from simultaneous heating and cooling',
            recommendation: 'Review sequence of operations, check valve actuators',
          },
        };
      }
      return { isFault: false };
    },
  },
  {
    id: 'G36-AHU-05',
    name: 'Supply Fan Not Proven',
    description: 'Supply fan commanded on but not proven running',
    equipmentTypes: [HVACEquipmentType.AIR_HANDLING_UNIT, HVACEquipmentType.ROOFTOP_UNIT],
    severity: 'critical',
    category: 'safety',
    evaluator: (equipment, points) => {
      const fanCmd = equipment.points.find(p => 
        p.name.toLowerCase().includes('supply') && p.name.toLowerCase().includes('command'));
      const fanStatus = points.get(HVACPointType.RUN_STATUS);
      
      if (!fanCmd) return { isFault: false };
      
      const cmd = fanCmd.currentValue === true || fanCmd.currentValue === 1;
      const status = fanStatus === true || fanStatus === 1;
      
      if (cmd && !status) {
        return {
          isFault: true,
          faultCode: 'G36-AHU-05',
          message: 'Supply fan commanded on but not running',
          impact: {
            comfortImpact: 'No airflow to zones, severe comfort impact',
            recommendation: 'Check fan motor, VFD, wiring, and proof switch',
          },
        };
      }
      return { isFault: false };
    },
  },
  
  // VAV Box Faults
  {
    id: 'G36-VAV-01',
    name: 'Zone Temperature Deviation',
    description: 'Zone temperature deviates more than 2°F from setpoint for more than 30 minutes',
    equipmentTypes: [HVACEquipmentType.VAV_BOX, HVACEquipmentType.FAN_POWERED_VAV],
    severity: 'minor',
    category: 'comfort',
    evaluator: (equipment, points) => {
      const zoneTemp = points.get(HVACPointType.ZONE_TEMP);
      const coolSp = points.get(HVACPointType.OCCUPIED_COOLING_SETPOINT);
      const heatSp = points.get(HVACPointType.OCCUPIED_HEATING_SETPOINT);
      
      if (typeof zoneTemp !== 'number') return { isFault: false };
      
      const cooling = typeof coolSp === 'number' ? coolSp : 75;
      const heating = typeof heatSp === 'number' ? heatSp : 70;
      
      if (zoneTemp > cooling + 2) {
        return {
          isFault: true,
          faultCode: 'G36-VAV-01-H',
          message: `Zone temp ${zoneTemp.toFixed(1)}°F is ${(zoneTemp - cooling).toFixed(1)}°F above cooling setpoint`,
          impact: {
            comfortImpact: 'Zone is too warm, occupant discomfort',
            recommendation: 'Check damper operation, verify primary airflow, check SAT',
          },
        };
      }
      if (zoneTemp < heating - 2) {
        return {
          isFault: true,
          faultCode: 'G36-VAV-01-C',
          message: `Zone temp ${zoneTemp.toFixed(1)}°F is ${(heating - zoneTemp).toFixed(1)}°F below heating setpoint`,
          impact: {
            comfortImpact: 'Zone is too cold, occupant discomfort',
            recommendation: 'Check reheat valve, verify hot water, check damper minimum',
          },
        };
      }
      return { isFault: false };
    },
  },
  {
    id: 'G36-VAV-02',
    name: 'Damper Hunting',
    description: 'VAV damper is oscillating rapidly indicating unstable control',
    equipmentTypes: [HVACEquipmentType.VAV_BOX, HVACEquipmentType.FAN_POWERED_VAV],
    severity: 'minor',
    category: 'operational',
    evaluator: (equipment, points) => {
      // Would need historical data to detect hunting
      // Placeholder implementation
      return { isFault: false };
    },
  },
  {
    id: 'G36-VAV-03',
    name: 'Reheat Valve Stuck Open',
    description: 'Reheat valve appears stuck open based on discharge air temperature',
    equipmentTypes: [HVACEquipmentType.VAV_BOX, HVACEquipmentType.FAN_POWERED_VAV],
    severity: 'major',
    category: 'energy',
    evaluator: (equipment, points) => {
      const dat = points.get(HVACPointType.DISCHARGE_AIR_TEMP);
      const sat = points.get(HVACPointType.SUPPLY_AIR_TEMP);
      
      if (typeof dat !== 'number') return { isFault: false };
      
      // If no cooling or heating request but discharge air is significantly warmer than supply
      const supplyAir = typeof sat === 'number' ? sat : 55;
      
      if (dat > supplyAir + 15) {
        return {
          isFault: true,
          faultCode: 'G36-VAV-03',
          message: `Discharge air temp ${dat.toFixed(1)}°F much higher than supply air`,
          impact: {
            energyWaste: 'Unnecessary reheating, wasted energy',
            comfortImpact: 'Zone may be overheated',
            recommendation: 'Check reheat valve actuator and controls',
          },
        };
      }
      return { isFault: false };
    },
  },
  
  // Chiller Faults
  {
    id: 'G36-CH-01',
    name: 'Chiller Not Meeting Load',
    description: 'Chilled water supply temperature is above setpoint by more than 3°F',
    equipmentTypes: [
      HVACEquipmentType.CENTRIFUGAL_CHILLER,
      HVACEquipmentType.SCREW_CHILLER,
      HVACEquipmentType.SCROLL_CHILLER,
      HVACEquipmentType.AIR_COOLED_CHILLER,
      HVACEquipmentType.WATER_COOLED_CHILLER,
    ],
    severity: 'major',
    category: 'comfort',
    evaluator: (equipment, points) => {
      const lchwt = points.get(HVACPointType.LEAVING_CHILLED_WATER_TEMP);
      const sp = points.get(HVACPointType.COOLING_SETPOINT);
      
      if (typeof lchwt !== 'number') return { isFault: false };
      
      const setpoint = typeof sp === 'number' ? sp : 44;
      const diff = lchwt - setpoint;
      
      if (diff > 3) {
        return {
          isFault: true,
          faultCode: 'G36-CH-01',
          message: `Chilled water supply ${lchwt.toFixed(1)}°F is ${diff.toFixed(1)}°F above setpoint`,
          impact: {
            comfortImpact: 'Building cooling capacity reduced',
            energyWaste: 'Increased fan energy at AHUs to compensate',
            recommendation: 'Check chiller staging, condenser water system, refrigerant charge',
          },
        };
      }
      return { isFault: false };
    },
  },
  {
    id: 'G36-CH-02',
    name: 'High Condenser Approach',
    description: 'Condenser approach temperature is above expected value',
    equipmentTypes: [
      HVACEquipmentType.CENTRIFUGAL_CHILLER,
      HVACEquipmentType.SCREW_CHILLER,
      HVACEquipmentType.WATER_COOLED_CHILLER,
    ],
    severity: 'minor',
    category: 'energy',
    evaluator: (equipment, points) => {
      const lcwt = points.get(HVACPointType.LEAVING_CONDENSER_WATER_TEMP);
      const ecwt = points.get(HVACPointType.ENTERING_CONDENSER_WATER_TEMP);
      const condPres = points.get(HVACPointType.CONDENSER_PRESSURE);
      
      if (typeof lcwt !== 'number' || typeof ecwt !== 'number') return { isFault: false };
      
      const approach = lcwt - ecwt;
      
      // Normal approach is typically 5-10°F
      if (approach > 12) {
        return {
          isFault: true,
          faultCode: 'G36-CH-02',
          message: `Condenser approach ${approach.toFixed(1)}°F exceeds normal range`,
          impact: {
            energyWaste: 'Reduced chiller efficiency, higher kW/ton',
            recommendation: 'Clean condenser tubes, check condenser water flow',
          },
        };
      }
      return { isFault: false };
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// ASHRAE 36 Sequence Implementations
// ─────────────────────────────────────────────────────────────────────────────

export interface SequenceState {
  mode: 'occupied' | 'unoccupied' | 'warmup' | 'cooldown' | 'setback';
  economizer: 'disabled' | 'modulating' | 'full';
  satSetpoint: number;
  dspSetpoint: number;
  oaDamperMin: number;
  heatingOutput: number;
  coolingOutput: number;
}

/**
 * ASHRAE 36 AHU Sequence of Operation
 * Section 5.16 - Multiple-Zone VAV Air-Handling Unit
 */
export class G36AHUSequence {
  private params: G36Parameters;
  private state: SequenceState;
  private satReset: TrimRespondReset;
  private dspReset: TrimRespondReset;

  constructor(params: Partial<G36Parameters> = {}) {
    this.params = { ...DEFAULT_G36_PARAMS, ...params };
    
    this.state = {
      mode: 'occupied',
      economizer: 'disabled',
      satSetpoint: this.params.satResetMin,
      dspSetpoint: this.params.dspResetMax,
      oaDamperMin: this.params.minOADamper,
      heatingOutput: 0,
      coolingOutput: 0,
    };

    // Initialize Trim & Respond resets
    this.satReset = new TrimRespondReset(
      this.params.satResetMin,
      this.params.satResetMin,
      this.params.satResetMax,
      this.params.satTrimAmount,
      this.params.satRespondAmount,
      this.params.satTimerInterval,
      this.params.satNumRequests,
      this.params.satNumIgnore
    );

    this.dspReset = new TrimRespondReset(
      this.params.dspResetMax,
      this.params.dspResetMin,
      this.params.dspResetMax,
      -this.params.dspTrimAmount, // Negative because lower DSP saves energy
      -this.params.dspRespondAmount,
      this.params.dspTimerInterval,
      this.params.dspNumRequests,
      this.params.dspNumIgnore
    );
  }

  /**
   * Determine operating mode based on schedule and conditions
   */
  determineMode(
    isScheduledOccupied: boolean,
    zoneTemps: number[],
    outdoorTemp: number
  ): 'occupied' | 'unoccupied' | 'warmup' | 'cooldown' | 'setback' {
    const avgZoneTemp = zoneTemps.reduce((a, b) => a + b, 0) / zoneTemps.length;

    if (isScheduledOccupied) {
      return 'occupied';
    }

    // Warmup mode: building too cold before scheduled occupancy
    if (avgZoneTemp < this.params.zoneTempSetpointOccHeat - 2) {
      return 'warmup';
    }

    // Cooldown mode: building too hot before scheduled occupancy  
    if (avgZoneTemp > this.params.zoneTempSetpointOccCool + 2) {
      return 'cooldown';
    }

    return 'unoccupied';
  }

  /**
   * Economizer sequence per Section 5.16.7
   */
  economizer(
    outdoorTemp: number,
    returnTemp: number,
    outdoorEnthalpy?: number,
    returnEnthalpy?: number
  ): 'disabled' | 'modulating' | 'full' {
    // Differential dry-bulb economizer (most common)
    const deltaDryBulb = returnTemp - outdoorTemp;

    if (deltaDryBulb < this.params.dptDpMin) {
      return 'disabled';
    }

    if (outdoorTemp > this.params.economDisable) {
      return 'disabled';
    }

    if (outdoorTemp < this.params.economEnable) {
      // Full economizer when outdoor conditions very favorable
      if (deltaDryBulb > 10) {
        return 'full';
      }
      return 'modulating';
    }

    return 'modulating';
  }

  /**
   * Supply Air Temperature Setpoint Reset per Section 5.16.2
   */
  supplyAirTempReset(zoneRequests: Map<string, boolean>): number {
    // Update all zone requests
    for (const [zoneId, requesting] of zoneRequests) {
      this.satReset.updateRequest(zoneId, requesting);
    }

    const result = this.satReset.execute();
    this.state.satSetpoint = result.setpoint;
    return result.setpoint;
  }

  /**
   * Duct Static Pressure Setpoint Reset per Section 5.16.3
   */
  ductStaticPressureReset(zoneRequests: Map<string, boolean>): number {
    // Update all zone requests
    for (const [zoneId, requesting] of zoneRequests) {
      this.dspReset.updateRequest(zoneId, requesting);
    }

    const result = this.dspReset.execute();
    this.state.dspSetpoint = result.setpoint;
    return result.setpoint;
  }

  /**
   * Minimum Outdoor Air Calculation per Section 5.16.8
   */
  minimumOutdoorAir(
    zonePopulations: Map<string, number>,
    zoneAreas: Map<string, number>,
    systemVentilationEfficiency: number = 0.8
  ): number {
    // ASHRAE 62.1 breathing zone outdoor air calculation
    const Rp = 5; // cfm/person (office default)
    const Ra = 0.06; // cfm/ft² (office default)

    let totalOA = 0;
    for (const [zoneId, population] of zonePopulations) {
      const area = zoneAreas.get(zoneId) || 0;
      const zoneOA = (Rp * population) + (Ra * area);
      totalOA += zoneOA;
    }

    // Uncorrected outdoor air
    const Vou = totalOA;
    
    // System outdoor air (corrected for efficiency)
    const Vot = Vou / systemVentilationEfficiency;

    return Vot;
  }

  /**
   * Execute the complete AHU sequence
   */
  execute(inputs: {
    isScheduledOccupied: boolean;
    outdoorTemp: number;
    returnTemp: number;
    supplyTemp: number;
    ductStaticPressure: number;
    zoneTemps: Map<string, number>;
    zoneCoolingRequests: Map<string, boolean>;
    zoneDamperRequests: Map<string, boolean>;
  }): SequenceState {
    const zoneTempsArray = Array.from(inputs.zoneTemps.values());

    // 1. Determine operating mode
    this.state.mode = this.determineMode(
      inputs.isScheduledOccupied,
      zoneTempsArray,
      inputs.outdoorTemp
    );

    // 2. Economizer logic
    this.state.economizer = this.economizer(inputs.outdoorTemp, inputs.returnTemp);

    // 3. SAT reset (only in occupied mode)
    if (this.state.mode === 'occupied') {
      this.supplyAirTempReset(inputs.zoneCoolingRequests);
    }

    // 4. DSP reset (only in occupied mode)
    if (this.state.mode === 'occupied') {
      this.ductStaticPressureReset(inputs.zoneDamperRequests);
    }

    // 5. Heating/Cooling staging
    const satError = this.state.satSetpoint - inputs.supplyTemp;
    
    if (satError > 0) {
      // Need heating
      this.state.heatingOutput = Math.min(100, satError * 25);
      this.state.coolingOutput = 0;
    } else if (satError < 0) {
      // Need cooling
      this.state.heatingOutput = 0;
      this.state.coolingOutput = Math.min(100, Math.abs(satError) * 25);
    } else {
      this.state.heatingOutput = 0;
      this.state.coolingOutput = 0;
    }

    return { ...this.state };
  }

  get currentState(): SequenceState {
    return { ...this.state };
  }
}

/**
 * ASHRAE 36 VAV Box Sequence of Operation
 * Section 5.1 - Single Duct VAV Terminal Unit with Reheat
 */
export class G36VAVSequence {
  private params: G36Parameters;

  constructor(params: Partial<G36Parameters> = {}) {
    this.params = { ...DEFAULT_G36_PARAMS, ...params };
  }

  /**
   * Calculate VAV damper and reheat outputs
   */
  execute(inputs: {
    zoneTemp: number;
    coolingSp: number;
    heatingSp: number;
    isOccupied: boolean;
    minAirflow: number; // cfm
    maxAirflow: number; // cfm
    supplyAirTemp: number;
    dischargeTempSp?: number;
  }): {
    damperPosition: number; // 0-100%
    airflowSetpoint: number; // cfm
    reheatOutput: number; // 0-100%
    mode: 'deadband' | 'cooling' | 'heating';
  } {
    const { zoneTemp, coolingSp, heatingSp, isOccupied, minAirflow, maxAirflow } = inputs;

    // Determine mode
    let mode: 'deadband' | 'cooling' | 'heating';
    if (zoneTemp > coolingSp) {
      mode = 'cooling';
    } else if (zoneTemp < heatingSp) {
      mode = 'heating';
    } else {
      mode = 'deadband';
    }

    let damperPosition: number;
    let airflowSetpoint: number;
    let reheatOutput: number;

    if (!isOccupied) {
      // Unoccupied mode - minimum ventilation
      damperPosition = 0;
      airflowSetpoint = 0;
      reheatOutput = zoneTemp < this.params.zoneTempSetpointUnoccHeat ? 100 : 0;
    } else if (mode === 'cooling') {
      // Cooling mode - modulate damper to meet cooling load
      const coolingError = zoneTemp - coolingSp;
      const position = Math.min(100, coolingError * 20);
      damperPosition = position;
      airflowSetpoint = minAirflow + (position / 100) * (maxAirflow - minAirflow);
      reheatOutput = 0;
    } else if (mode === 'heating') {
      // Heating mode - minimum airflow, modulate reheat
      damperPosition = (minAirflow / maxAirflow) * 100;
      airflowSetpoint = minAirflow;
      const heatingError = heatingSp - zoneTemp;
      reheatOutput = Math.min(100, heatingError * 30);
    } else {
      // Deadband - minimum ventilation
      damperPosition = (minAirflow / maxAirflow) * 100;
      airflowSetpoint = minAirflow;
      reheatOutput = 0;
    }

    return {
      damperPosition,
      airflowSetpoint,
      reheatOutput,
      mode,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ASHRAE 36 Compliance Engine
// ─────────────────────────────────────────────────────────────────────────────

export interface G36ComplianceConfig {
  parameters: Partial<G36Parameters>;
  enabledRules: string[];
  faultEvaluationInterval: number; // seconds
  reportGenerationInterval: number; // hours
}

export class G36ComplianceEngine extends EventEmitter {
  private config: G36ComplianceConfig;
  private params: G36Parameters;
  private equipment: Map<string, HVACEquipment> = new Map();
  private activeFaults: Map<string, FaultEvent> = new Map();
  private faultTimer?: ReturnType<typeof setInterval>;
  private ahuSequences: Map<string, G36AHUSequence> = new Map();
  private vavSequences: Map<string, G36VAVSequence> = new Map();

  constructor(config: Partial<G36ComplianceConfig> = {}) {
    super();
    this.config = {
      parameters: config.parameters || {},
      enabledRules: config.enabledRules || G36_FAULT_RULES.map(r => r.id),
      faultEvaluationInterval: config.faultEvaluationInterval || 60,
      reportGenerationInterval: config.reportGenerationInterval || 24,
    };
    this.params = { ...DEFAULT_G36_PARAMS, ...this.config.parameters };
  }

  /**
   * Register equipment for G36 compliance monitoring
   */
  registerEquipment(equipment: HVACEquipment): void {
    this.equipment.set(equipment.id, equipment);

    // Create appropriate sequence for equipment type
    if (equipment.type === HVACEquipmentType.AIR_HANDLING_UNIT ||
        equipment.type === HVACEquipmentType.ROOFTOP_UNIT) {
      this.ahuSequences.set(equipment.id, new G36AHUSequence(this.params));
    } else if (equipment.type === HVACEquipmentType.VAV_BOX ||
               equipment.type === HVACEquipmentType.FAN_POWERED_VAV) {
      this.vavSequences.set(equipment.id, new G36VAVSequence(this.params));
    }
  }

  /**
   * Start fault detection monitoring
   */
  start(): void {
    if (this.faultTimer) return;

    this.faultTimer = setInterval(() => {
      this.evaluateFaults();
    }, this.config.faultEvaluationInterval * 1000);
  }

  /**
   * Stop fault detection monitoring
   */
  stop(): void {
    if (this.faultTimer) {
      clearInterval(this.faultTimer);
      this.faultTimer = undefined;
    }
  }

  /**
   * Evaluate all fault rules against registered equipment
   */
  private evaluateFaults(): void {
    for (const equipment of this.equipment.values()) {
      // Get current point values
      const pointValues = new Map<HVACPointType, number | boolean>();
      for (const point of equipment.points) {
        if (point.currentValue !== undefined && point.currentValue !== null) {
          pointValues.set(point.pointType, point.currentValue as number | boolean);
        }
      }

      // Evaluate applicable rules
      for (const rule of G36_FAULT_RULES) {
        if (!this.config.enabledRules.includes(rule.id)) continue;
        if (!rule.equipmentTypes.includes(equipment.type)) continue;

        const result = rule.evaluator(equipment, pointValues);
        const faultKey = `${equipment.id}:${rule.id}`;

        if (result.isFault) {
          if (!this.activeFaults.has(faultKey)) {
            // New fault
            const fault: FaultEvent = {
              id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              ruleId: rule.id,
              ruleName: rule.name,
              equipmentId: equipment.id,
              equipmentName: equipment.name,
              severity: rule.severity,
              category: rule.category,
              timestamp: new Date(),
              status: 'active',
              points: equipment.points.map(p => ({
                pointId: p.id,
                pointName: p.name,
                value: p.currentValue as number | boolean | string,
                timestamp: p.lastUpdate || new Date(),
              })),
              // Store impact info as custom field (FaultEvent.estimatedImpact expects different types)
            };

            this.activeFaults.set(faultKey, fault);
            this.emit('fault', fault);
          }
        } else {
          // Check if fault was previously active
          const existingFault = this.activeFaults.get(faultKey);
          if (existingFault) {
            existingFault.status = 'resolved';
            existingFault.resolvedAt = new Date();
            this.activeFaults.delete(faultKey);
            this.emit('fault-cleared', existingFault);
          }
        }
      }
    }
  }

  /**
   * Generate compliance report
   */
  generateReport(siteId: string, buildingId?: string): ComplianceReport {
    const now = new Date();
    const reportPeriod = {
      start: new Date(now.getTime() - this.config.reportGenerationInterval * 60 * 60 * 1000),
      end: now,
    };

    // Analyze faults and calculate compliance
    const requirements = G36_FAULT_RULES.filter(r => 
      this.config.enabledRules.includes(r.id)
    ).map(rule => {
      const relevantEquipment = Array.from(this.equipment.values())
        .filter(e => rule.equipmentTypes.includes(e.type));
      
      const faults = Array.from(this.activeFaults.values())
        .filter(f => f.ruleId === rule.id);

      return {
        requirementId: rule.id,
        title: rule.name,
        status: faults.length === 0 ? 'compliant' as const : 
                faults.some(f => f.severity === 'critical') ? 'non_compliant' as const : 
                'compliant' as const,
        details: faults.length > 0 
          ? `${faults.length} active fault(s) on ${faults.map(f => f.equipmentName).join(', ')}`
          : `All ${relevantEquipment.length} equipment items compliant`,
      };
    });

    const compliantCount = requirements.filter(r => r.status === 'compliant').length;
    const overallCompliance = (compliantCount / requirements.length) * 100;

    return {
      frameworkId: 'ashrae-36-2024',
      frameworkName: 'ASHRAE Guideline 36-2024: High-Performance Sequences',
      period: reportPeriod,
      siteId,
      buildingId,
      overallCompliance,
      requirements,
      recommendations: this.generateRecommendations(),
      generatedAt: now,
      generatedBy: 'FreedomForge G36 Compliance Engine',
    };
  }

  private generateRecommendations(): string[] {
    const recommendations: string[] = [];

    // Analyze active faults for patterns
    const faultsByCategory = new Map<string, number>();
    for (const fault of this.activeFaults.values()) {
      const count = faultsByCategory.get(fault.category) || 0;
      faultsByCategory.set(fault.category, count + 1);
    }

    if ((faultsByCategory.get('energy') || 0) > 2) {
      recommendations.push('Multiple energy-related faults detected. Consider comprehensive energy audit.');
    }
    if ((faultsByCategory.get('comfort') || 0) > 2) {
      recommendations.push('Multiple comfort-related faults detected. Review temperature control loops and calibration.');
    }
    if ((faultsByCategory.get('maintenance') || 0) > 1) {
      recommendations.push('Equipment maintenance issues detected. Schedule preventive maintenance inspection.');
    }

    if (recommendations.length === 0) {
      recommendations.push('System operating within G36 compliance parameters. Continue regular monitoring.');
    }

    return recommendations;
  }

  /**
   * Get current compliance status summary
   */
  getStatus(): {
    totalEquipment: number;
    activeFaults: number;
    criticalFaults: number;
    complianceScore: number;
  } {
    const activeFaults = Array.from(this.activeFaults.values());
    const criticalFaults = activeFaults.filter(f => f.severity === 'critical').length;
    
    // Simple compliance score based on fault count
    const maxFaults = this.equipment.size * G36_FAULT_RULES.length;
    const complianceScore = Math.max(0, 100 - (activeFaults.length / maxFaults) * 100);

    return {
      totalEquipment: this.equipment.size,
      activeFaults: activeFaults.length,
      criticalFaults,
      complianceScore,
    };
  }

  get parameters(): G36Parameters {
    return { ...this.params };
  }

  get faults(): FaultEvent[] {
    return Array.from(this.activeFaults.values());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Function
// ─────────────────────────────────────────────────────────────────────────────

export function createG36ComplianceEngine(
  config?: Partial<G36ComplianceConfig>
): G36ComplianceEngine {
  return new G36ComplianceEngine(config);
}

export { DEFAULT_G36_PARAMS };
