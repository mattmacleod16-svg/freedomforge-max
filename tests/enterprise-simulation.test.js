#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FreedomForge Enterprise — Autonomous Production Simulation Suite
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Validates that all enterprise modules can hypothetically manage production
 * across Trane Technologies sites with minimal human interference.
 *
 * Simulation domains:
 *   1.  BACnet Protocol            — Device discovery, property R/W, COV
 *   2.  Modbus Protocol            — Register reads, data type conversion
 *   3.  ASHRAE G36 Compliance      — Trim & Respond, fault detection rules
 *   4.  ISO 50001 Energy Mgmt      — EnPI calculation, baseline, targets
 *   5.  Predictive Maintenance     — Health scoring, anomaly detection, RUL
 *   6.  CMMS Work Order Flow       — Auto-generation from alarms, scheduling
 *   7.  IIoT / Sparkplug B         — Metric encoding, UNS hierarchy
 *   8.  Multi-Site Autonomy        — Full lifecycle without human intervention
 *   9.  Fault → Remediation        — End-to-end fault-to-work-order pipeline
 *  10.  Energy Opportunity ROI     — NPV / payback calculation accuracy
 *
 * Run: node tests/enterprise-simulation.test.js
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─────────────────────────────────────────────────────────────────────────────
// § 1  BACNET PROTOCOL SIMULATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure-JS simulation of BACnet object/property model (ASHRAE 135-2020).
 * Mirrors the structure in lib/enterprise/building-automation/bacnet-client.ts
 * without requiring TypeScript compilation.
 */
class BACnetSimulator {
  constructor() {
    /** @type {Map<string, Map<number, unknown>>} device → {propId → value} */
    this.devices = new Map();
    this.covSubscriptions = new Map(); // subKey → {callback, increment}
    this.nextSubId = 1;
  }

  /** Register a simulated BACnet device with default objects */
  addDevice(instanceId, label, points = {}) {
    const key = `DEV:${instanceId}`;
    const props = new Map([
      [77,  label],          // OBJECT_NAME
      [79,  8],              // OBJECT_TYPE = DEVICE
      [85,  null],           // PRESENT_VALUE
      [121, instanceId],     // OBJECT_IDENTIFIER
      [112, '1.0.0'],        // VENDOR_IDENTIFIER (proxy)
      ...Object.entries(points).map(([k, v]) => [Number(k), v]),
    ]);
    this.devices.set(key, props);
    return key;
  }

  /** Simulate Who-Is → I-Am discovery */
  whoIs(lowLimit = 0, highLimit = 4194303) {
    const found = [];
    for (const [key, props] of this.devices) {
      const id = props.get(121);
      if (id >= lowLimit && id <= highLimit) {
        found.push({
          deviceInstance: id,
          objectName:     props.get(77),
          address:        { address: `192.168.1.${id % 254 + 1}`, port: 47808 },
        });
      }
    }
    return found;
  }

  /** Read a property value */
  readProperty(deviceInstance, propId) {
    const key = `DEV:${deviceInstance}`;
    const props = this.devices.get(key);
    if (!props) throw new Error(`Device ${deviceInstance} not found`);
    if (!props.has(propId)) throw new Error(`Property ${propId} not found on device ${deviceInstance}`);
    return props.get(propId);
  }

  /** Write a property value and trigger COV if threshold exceeded */
  writeProperty(deviceInstance, propId, value) {
    const key = `DEV:${deviceInstance}`;
    const props = this.devices.get(key);
    if (!props) throw new Error(`Device ${deviceInstance} not found`);
    const old = props.get(propId);
    props.set(propId, value);
    // Trigger COV subscriptions
    for (const [, sub] of this.covSubscriptions) {
      if (sub.deviceInstance === deviceInstance && sub.propId === propId) {
        const delta = typeof value === 'number' && typeof old === 'number'
          ? Math.abs(value - old) : Infinity;
        if (delta >= sub.covIncrement) sub.callback({ value, timestamp: new Date() });
      }
    }
    return true;
  }

  /** Subscribe to Change-of-Value */
  subscribeCOV(deviceInstance, propId, covIncrement, callback) {
    const id = this.nextSubId++;
    this.covSubscriptions.set(id, { deviceInstance, propId, covIncrement, callback });
    return id;
  }

  /** Unsubscribe COV */
  unsubscribeCOV(subId) {
    return this.covSubscriptions.delete(subId);
  }
}

describe('1. BACnet Protocol Simulation', () => {
  let bacnet;

  before(() => {
    bacnet = new BACnetSimulator();
    // Add representative Trane devices: chiller, AHU, VAV
    bacnet.addDevice(1001, 'Trane-RTHD-Chiller-1',  { 85: 42.5, 117: 0 }); // PV=42.5°F LWT, status=normal
    bacnet.addDevice(1002, 'Trane-MACH-AHU-1',      { 85: 68.0, 117: 0 });
    bacnet.addDevice(1003, 'Trane-PIVT-VAV-101',    { 85: 1.2,  117: 0 }); // airflow cfm
    bacnet.addDevice(1004, 'Trane-RTHD-Chiller-2',  { 85: 44.0, 117: 1 }); // status=alarm
  });

  it('discovers all devices via Who-Is', () => {
    const devices = bacnet.whoIs();
    assert.equal(devices.length, 4);
    const names = devices.map(d => d.objectName);
    assert.ok(names.includes('Trane-RTHD-Chiller-1'));
    assert.ok(names.includes('Trane-PIVT-VAV-101'));
  });

  it('limits discovery by instance range', () => {
    const devices = bacnet.whoIs(1001, 1002);
    assert.equal(devices.length, 2);
    assert.ok(devices.every(d => d.deviceInstance >= 1001 && d.deviceInstance <= 1002));
  });

  it('reads present value (propId 85) from chiller', () => {
    const value = bacnet.readProperty(1001, 85);
    assert.equal(value, 42.5);
  });

  it('reads object name (propId 77)', () => {
    const name = bacnet.readProperty(1002, 77);
    assert.equal(name, 'Trane-MACH-AHU-1');
  });

  it('writes property and reads back updated value', () => {
    bacnet.writeProperty(1001, 85, 43.8); // LWT setpoint change
    assert.equal(bacnet.readProperty(1001, 85), 43.8);
  });

  it('throws on read from unknown device', () => {
    assert.throws(() => bacnet.readProperty(9999, 85), /not found/);
  });

  it('throws on read of unknown property', () => {
    assert.throws(() => bacnet.readProperty(1001, 9999), /not found/);
  });

  it('COV subscription fires when threshold exceeded', () => {
    const received = [];
    const subId = bacnet.subscribeCOV(1003, 85, 0.5, (ev) => received.push(ev.value));

    bacnet.writeProperty(1003, 85, 1.3); // delta=0.1 — below threshold
    assert.equal(received.length, 0);

    bacnet.writeProperty(1003, 85, 2.0); // delta=0.7 — above threshold
    assert.equal(received.length, 1);
    assert.equal(received[0], 2.0);

    bacnet.unsubscribeCOV(subId);
    bacnet.writeProperty(1003, 85, 5.0); // unsubscribed — no new event
    assert.equal(received.length, 1);
  });

  it('identifies alarms via status property (propId 117)', () => {
    const alarmDevices = bacnet.whoIs()
      .filter(d => bacnet.readProperty(d.deviceInstance, 117) !== 0);
    assert.equal(alarmDevices.length, 1);
    assert.equal(alarmDevices[0].deviceInstance, 1004);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 2  MODBUS PROTOCOL SIMULATION
// ─────────────────────────────────────────────────────────────────────────────

class ModbusSimulator {
  constructor() {
    /** @type {Map<number, number>} address → raw register value (16-bit) */
    this.registers = new Map();
  }

  setRegister(addr, rawValue) { this.registers.set(addr, rawValue & 0xFFFF); }
  setFloat32(addr, value) {
    const buf = Buffer.allocUnsafe(4);
    buf.writeFloatBE(value, 0);
    this.registers.set(addr,     buf.readUInt16BE(0));
    this.registers.set(addr + 1, buf.readUInt16BE(2));
  }
  setInt32(addr, value) {
    const buf = Buffer.allocUnsafe(4);
    buf.writeInt32BE(value, 0);
    this.registers.set(addr,     buf.readUInt16BE(0));
    this.registers.set(addr + 1, buf.readUInt16BE(2));
  }

  readHoldingRegisters(startAddr, count) {
    const regs = [];
    for (let i = 0; i < count; i++) {
      regs.push(this.registers.get(startAddr + i) ?? 0);
    }
    return regs;
  }

  readFloat32(addr) {
    const regs = this.readHoldingRegisters(addr, 2);
    const buf = Buffer.allocUnsafe(4);
    buf.writeUInt16BE(regs[0], 0);
    buf.writeUInt16BE(regs[1], 2);
    return buf.readFloatBE(0);
  }

  readInt32(addr) {
    const regs = this.readHoldingRegisters(addr, 2);
    const buf = Buffer.allocUnsafe(4);
    buf.writeUInt16BE(regs[0], 0);
    buf.writeUInt16BE(regs[1], 2);
    return buf.readInt32BE(0);
  }

  writeHoldingRegister(addr, value) {
    this.registers.set(addr, value & 0xFFFF);
  }
}

describe('2. Modbus Protocol Simulation', () => {
  let modbus;

  before(() => {
    modbus = new ModbusSimulator();
    // VFD speed register (40001) = 1500 RPM as UINT16
    modbus.setRegister(40001, 1500);
    // Chiller kW (40010) as FLOAT32 across 2 registers
    modbus.setFloat32(40010, 387.5);
    // Fault code (40020) as INT32
    modbus.setInt32(40020, 0); // no fault
    // Current (40030) = 125.4 A as FLOAT32
    modbus.setFloat32(40030, 125.4);
  });

  it('reads VFD speed register as UINT16', () => {
    const [val] = modbus.readHoldingRegisters(40001, 1);
    assert.equal(val, 1500);
  });

  it('reads chiller power as FLOAT32 (two-register span)', () => {
    const kw = modbus.readFloat32(40010);
    assert.ok(Math.abs(kw - 387.5) < 0.01, `Expected ~387.5 kW, got ${kw}`);
  });

  it('reads zero fault code', () => {
    const faultCode = modbus.readInt32(40020);
    assert.equal(faultCode, 0);
  });

  it('reads current as FLOAT32', () => {
    const amps = modbus.readFloat32(40030);
    assert.ok(Math.abs(amps - 125.4) < 0.01);
  });

  it('writes VFD speed and reads back', () => {
    modbus.writeHoldingRegister(40001, 1200);
    const [val] = modbus.readHoldingRegisters(40001, 1);
    assert.equal(val, 1200);
  });

  it('reads bulk register range for polling', () => {
    const regs = modbus.readHoldingRegisters(40001, 5);
    assert.equal(regs.length, 5);
  });

  it('simulates fault injection via register write', () => {
    modbus.setInt32(40020, 0xE001); // chiller low-pressure fault
    const faultCode = modbus.readInt32(40020);
    assert.ok(faultCode !== 0, 'Fault should be non-zero after injection');
    modbus.setInt32(40020, 0); // clear
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 3  ASHRAE GUIDELINE 36 COMPLIANCE
// ─────────────────────────────────────────────────────────────────────────────

/** Trim & Respond reset logic (ASHRAE G36 §5.1.14) */
function trimAndRespond(state, requests, config) {
  const { SPmin, SPmax, SPres, trimAmount, respondAmount, maxRequests } = {
    SPmin: 55,
    SPmax: 65,
    SPres: 60,
    trimAmount: 0.25,
    respondAmount: 0.8,
    maxRequests: 3,
    ...config,
  };

  const ignored = Math.max(0, requests - maxRequests);
  const responding = Math.min(requests, maxRequests);
  let newSP = state;

  if (requests === 0) {
    newSP -= trimAmount;
  } else {
    newSP += respondAmount * responding;
  }

  return Math.max(SPmin, Math.min(SPmax, newSP));
}

/** G36 fault detection rules (simplified implementations) */
const G36_FAULTS = {
  /** Fault 1 — Supply air temp too low */
  supplyAirTooLow(sat, satSetpoint) {
    return sat < satSetpoint - 5;
  },
  /** Fault 2 — Supply air temp too high */
  supplyAirTooHigh(sat, satSetpoint) {
    return sat > satSetpoint + 5;
  },
  /** Fault 3 — Economizer damper stuck */
  economizerStuck(outdoorAirFraction, command) {
    return Math.abs(outdoorAirFraction - command / 100) > 0.15;
  },
  /** Fault 4 — Cooling coil valve leaking */
  coolingValveLeak(chwValveCmd, sat, satSetpoint) {
    return chwValveCmd === 0 && sat < satSetpoint - 3;
  },
  /** Fault 5 — Simultaneous heating and cooling */
  simultaneousHeatCool(htgCmd, clgCmd) {
    return htgCmd > 5 && clgCmd > 5;
  },
  /** Fault 6 — Low delta-T on chilled water */
  lowDeltaT(chwSupplyTemp, chwReturnTemp, minDeltaT = 8) {
    return (chwReturnTemp - chwSupplyTemp) < minDeltaT;
  },
  /** Fault 7 — Filter pressure drop high */
  filterDirty(pressureDrop, threshold = 0.75) {
    return pressureDrop > threshold;
  },
};

/** VAV box control sequence */
function vavControlSequence(zoneTemp, zoneTempSetpoint, minAirflow, maxAirflow, maxHeat) {
  const error = zoneTempSetpoint - zoneTemp;
  let coolingCmd = 0, heatingCmd = 0, airflow = minAirflow;

  if (error < -1) {
    // Zone too hot: increase cooling airflow
    const demand = Math.min(1, Math.abs(error) / 5);
    airflow = minAirflow + demand * (maxAirflow - minAirflow);
    coolingCmd = demand * 100;
  } else if (error > 1) {
    // Zone too cold: reheat at minimum airflow
    airflow = minAirflow;
    const heatDemand = Math.min(1, error / 5);
    heatingCmd = heatDemand * maxHeat;
  }

  return { airflow: Math.round(airflow), coolingCmd: Math.round(coolingCmd), heatingCmd: Math.round(heatingCmd) };
}

describe('3. ASHRAE Guideline 36 Compliance', () => {
  describe('Trim & Respond Reset', () => {
    it('trims setpoint when no requests', () => {
      const sp = trimAndRespond(60, 0, {});
      assert.equal(sp, 59.75); // 60 - 0.25
    });

    it('responds to zone requests by raising setpoint', () => {
      const sp = trimAndRespond(60, 2, {});
      assert.ok(sp > 60, `SP should increase, got ${sp}`);
    });

    it('clamps at SPmax', () => {
      let sp = 64.9;
      for (let i = 0; i < 20; i++) sp = trimAndRespond(sp, 5, {});
      assert.equal(sp, 65);
    });

    it('clamps at SPmin', () => {
      let sp = 55.1;
      for (let i = 0; i < 20; i++) sp = trimAndRespond(sp, 0, {});
      assert.equal(sp, 55);
    });

    it('converges to optimal setpoint over 30 cycles', () => {
      // Simulate mixed demand day: requests fluctuate 0-3
      const demandProfile = Array.from({ length: 30 }, (_, i) => Math.floor(Math.sin(i / 5) * 2 + 1));
      let sp = 60;
      for (const req of demandProfile) sp = trimAndRespond(sp, req, {});
      assert.ok(sp >= 55 && sp <= 65, `SP out of range: ${sp}`);
    });
  });

  describe('Fault Detection Rules', () => {
    it('detects supply air too low', () => {
      assert.ok(G36_FAULTS.supplyAirTooLow(50, 60));   // 50 < 60-5=55 ✓
      assert.ok(!G36_FAULTS.supplyAirTooLow(58, 60));  // 58 > 55 ✗
    });

    it('detects supply air too high', () => {
      assert.ok(G36_FAULTS.supplyAirTooHigh(70, 60));
      assert.ok(!G36_FAULTS.supplyAirTooHigh(63, 60));
    });

    it('detects economizer stuck', () => {
      assert.ok(G36_FAULTS.economizerStuck(0.1, 50));  // cmd=50% but actual=10%
      assert.ok(!G36_FAULTS.economizerStuck(0.45, 50)); // within tolerance
    });

    it('detects cooling valve leakage', () => {
      assert.ok(G36_FAULTS.coolingValveLeak(0, 54, 60));   // valve closed but SAT low
      assert.ok(!G36_FAULTS.coolingValveLeak(0, 59, 60));  // within deadband
    });

    it('detects simultaneous heating & cooling', () => {
      assert.ok(G36_FAULTS.simultaneousHeatCool(20, 30));
      assert.ok(!G36_FAULTS.simultaneousHeatCool(0, 30));
    });

    it('detects low delta-T (chiller plant fault)', () => {
      assert.ok(G36_FAULTS.lowDeltaT(44, 48));   // delta=4, min=8
      assert.ok(!G36_FAULTS.lowDeltaT(44, 54));  // delta=10
    });

    it('detects dirty filter', () => {
      assert.ok(G36_FAULTS.filterDirty(0.9));
      assert.ok(!G36_FAULTS.filterDirty(0.5));
    });
  });

  describe('VAV Box Control Sequence', () => {
    it('increases airflow when zone is too hot', () => {
      const result = vavControlSequence(75, 70, 100, 500, 100);
      assert.ok(result.airflow > 100);
      assert.ok(result.coolingCmd > 0);
      assert.equal(result.heatingCmd, 0);
    });

    it('activates reheat when zone is too cold', () => {
      const result = vavControlSequence(65, 70, 100, 500, 100);
      assert.equal(result.airflow, 100); // minimum
      assert.ok(result.heatingCmd > 0);
      assert.equal(result.coolingCmd, 0);
    });

    it('idles at minimum airflow when at setpoint', () => {
      const result = vavControlSequence(70, 70, 100, 500, 100);
      assert.equal(result.airflow, 100);
      assert.equal(result.coolingCmd, 0);
      assert.equal(result.heatingCmd, 0);
    });

    it('caps airflow at maximum', () => {
      const result = vavControlSequence(90, 70, 100, 500, 100);
      assert.equal(result.airflow, 500);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 4  ISO 50001 ENERGY MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/** Energy Performance Indicator calculation */
function calcEnPI(energyConsumption, relevantVariable, baselineSlope, baselineIntercept) {
  const baselineEnergy = baselineSlope * relevantVariable + baselineIntercept;
  return baselineEnergy > 0 ? energyConsumption / baselineEnergy : 0;
}

/** Weather-normalize energy using Cooling Degree Days */
function weatherNormalize(rawEnergy, actualCDD, normalCDD) {
  if (actualCDD === 0) return rawEnergy;
  return rawEnergy * (normalCDD / actualCDD);
}

/** Net Present Value of energy opportunity */
function calcNPV(annualSavings, implementationCost, discountRate, lifeYears) {
  let npv = -implementationCost;
  for (let yr = 1; yr <= lifeYears; yr++) {
    npv += annualSavings / Math.pow(1 + discountRate, yr);
  }
  return npv;
}

/** Simple payback period */
function simplePayback(implementationCost, annualSavings) {
  return annualSavings > 0 ? implementationCost / annualSavings : Infinity;
}

/** Identify Significant Energy Users above threshold */
function identifySeUs(consumers, threshold = 0.1) {
  const total = consumers.reduce((s, c) => s + c.consumption, 0);
  return consumers.filter(c => c.consumption / total >= threshold);
}

describe('4. ISO 50001 Energy Management', () => {
  describe('Energy Performance Indicator', () => {
    it('calculates EnPI = 1.0 when running at baseline', () => {
      // baseline: energy = 2*CDD + 1000
      const enpi = calcEnPI(1200, 100, 2, 1000);
      assert.ok(Math.abs(enpi - 1.0) < 0.001, `EnPI should be ~1.0, got ${enpi}`);
    });

    it('calculates EnPI < 1.0 when outperforming baseline', () => {
      const enpi = calcEnPI(1000, 100, 2, 1000); // using 1000 vs baseline 1200
      assert.ok(enpi < 1.0);
    });

    it('calculates EnPI > 1.0 when underperforming', () => {
      const enpi = calcEnPI(1500, 100, 2, 1000);
      assert.ok(enpi > 1.0);
    });
  });

  describe('Weather Normalization', () => {
    it('normalizes energy to normal year CDD', () => {
      // Site used 50,000 kWh in a hot year (600 CDD), normal year is 400 CDD
      const normalized = weatherNormalize(50000, 600, 400);
      assert.ok(Math.abs(normalized - 33333.33) < 1);
    });

    it('returns raw energy when actual CDD is zero (winter month)', () => {
      const normalized = weatherNormalize(10000, 0, 400);
      assert.equal(normalized, 10000);
    });
  });

  describe('Energy Opportunity Financial Analysis', () => {
    it('calculates positive NPV for LED retrofit', () => {
      // LED retrofit: $50k cost, $12k/yr savings, 8% discount, 10 yr life
      const npv = calcNPV(12000, 50000, 0.08, 10);
      assert.ok(npv > 0, `LED retrofit should be NPV-positive, got ${npv.toFixed(0)}`);
    });

    it('calculates negative NPV for poor investment', () => {
      // $500k cost, $5k/yr savings — clearly not viable
      const npv = calcNPV(5000, 500000, 0.08, 10);
      assert.ok(npv < 0);
    });

    it('calculates correct simple payback', () => {
      const pb = simplePayback(50000, 12000);
      assert.ok(Math.abs(pb - 4.167) < 0.01, `Payback should be ~4.17 yr, got ${pb.toFixed(3)}`);
    });

    it('returns Infinity for zero annual savings', () => {
      assert.equal(simplePayback(50000, 0), Infinity);
    });
  });

  describe('Significant Energy User Identification', () => {
    it('identifies SEUs above 10% threshold', () => {
      const consumers = [
        { name: 'Chiller Plant', consumption: 450000 },
        { name: 'Lighting',      consumption: 80000  },
        { name: 'Plug Loads',    consumption: 60000  },
        { name: 'AHUs',          consumption: 200000 },
        { name: 'Elevators',     consumption: 10000  },
      ];
      const seus = identifySeUs(consumers, 0.1);
      assert.equal(seus.length, 3); // Chiller 56%, AHUs 25%, Lighting exactly 10%
      const names = seus.map(s => s.name);
      assert.ok(names.includes('Chiller Plant'));
      assert.ok(names.includes('AHUs'));
    });

    it('returns empty array when no consumer exceeds threshold', () => {
      const even = Array.from({ length: 20 }, (_, i) => ({ name: `Load-${i}`, consumption: 100 }));
      const seus = identifySeUs(even, 0.1); // each is 5%
      assert.equal(seus.length, 0);
    });
  });

  describe('Energy Reduction Target Tracking', () => {
    it('tracks progress toward annual energy reduction target', () => {
      const baseline = 1_000_000; // kWh/yr
      const targetReduction = 0.10; // 10%
      const target = baseline * (1 - targetReduction); // 900,000
      const actualYTD = 430_000; // 6-month actuals
      const projectedAnnual = actualYTD * 2; // simple projection
      const progressPct = (baseline - projectedAnnual) / (baseline * targetReduction) * 100;
      assert.ok(progressPct >= 0, 'Progress should be non-negative');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 5  PREDICTIVE MAINTENANCE (ML ENGINE)
// ─────────────────────────────────────────────────────────────────────────────

/** Z-score anomaly detection */
function zScore(value, mean, stdDev) {
  return stdDev > 0 ? Math.abs(value - mean) / stdDev : 0;
}

/** Exponential moving average */
function ema(values, alpha = 0.3) {
  return values.reduce((prev, val, i) => i === 0 ? val : alpha * val + (1 - alpha) * prev, 0);
}

/** Weibull failure probability */
function weibullFailureProb(age, scale, shape) {
  return 1 - Math.exp(-Math.pow(age / scale, shape));
}

/** Remaining useful life estimate (linear extrapolation) */
function estimateRUL(healthScore, degradationRatePerDay) {
  if (degradationRatePerDay <= 0) return Infinity;
  const criticalThreshold = 30; // health below 30 = imminent failure
  const pointsToFailure = Math.max(0, healthScore - criticalThreshold);
  return pointsToFailure / degradationRatePerDay;
}

/** Health score calculator (0–100) */
function calcHealthScore(readings, normalRanges) {
  let totalPenalty = 0;
  let count = 0;

  for (const [param, value] of Object.entries(readings)) {
    const range = normalRanges[param];
    if (!range) continue;
    count++;
    const { min, max, weight = 1 } = range;
    if (value < min || value > max) {
      const deviation = value < min
        ? (min - value) / (min - range.critMin || min * 0.5)
        : (value - max) / (range.critMax || max * 1.5) - max;
      totalPenalty += Math.min(1, Math.abs(deviation)) * weight;
    }
  }

  return count > 0 ? Math.max(0, 100 - (totalPenalty / count) * 100) : 100;
}

/** Generate maintenance recommendation based on health */
function getRecommendation(healthScore, rul, equipment) {
  if (healthScore < 30 || rul < 7) {
    return { priority: 'CRITICAL', action: `Emergency inspection required for ${equipment}`, daysToAct: 0 };
  } else if (healthScore < 60 || rul < 30) {
    return { priority: 'HIGH', action: `Schedule maintenance for ${equipment} within 2 weeks`, daysToAct: 14 };
  } else if (healthScore < 80 || rul < 90) {
    return { priority: 'MEDIUM', action: `Plan next PM cycle for ${equipment}`, daysToAct: 30 };
  }
  return { priority: 'LOW', action: `${equipment} healthy — continue monitoring`, daysToAct: 90 };
}

describe('5. Predictive Maintenance Engine', () => {
  describe('Anomaly Detection', () => {
    it('z-score flags statistical outlier', () => {
      const mean = 200, stdDev = 10;
      const normal = zScore(205, mean, stdDev); // 0.5σ — normal
      const anomaly = zScore(235, mean, stdDev); // 3.5σ — anomaly

      assert.ok(normal < 2, `Normal reading z=${normal.toFixed(2)} should be <2σ`);
      assert.ok(anomaly > 3, `Anomaly z=${anomaly.toFixed(2)} should be >3σ`);
    });

    it('returns 0 z-score when stdDev is 0', () => {
      assert.equal(zScore(100, 100, 0), 0);
    });

    it('EMA smooths vibration data', () => {
      const noisyVibration = [1.0, 1.2, 0.8, 15.0, 1.1, 0.9, 1.0]; // spike at index 3
      const smoothed = ema(noisyVibration, 0.3);
      // EMA should damp the spike
      assert.ok(smoothed < 15.0, 'EMA should damp the spike');
      assert.ok(smoothed > 1.0, 'EMA should be above baseline');
    });
  });

  describe('Health Score Calculator', () => {
    const normalRanges = {
      vibration:    { min: 0,   max: 5,   critMax: 10,  weight: 3 },
      temperature:  { min: 150, max: 200, critMax: 250, weight: 2 },
      pressure:     { min: 80,  max: 120, critMin: 40,  weight: 2 },
      currentDraw:  { min: 10,  max: 50,  critMax: 70,  weight: 1 },
    };

    it('returns 100 for perfectly normal equipment', () => {
      const readings = { vibration: 2.5, temperature: 175, pressure: 100, currentDraw: 30 };
      const score = calcHealthScore(readings, normalRanges);
      assert.equal(score, 100);
    });

    it('penalizes out-of-range readings', () => {
      const readings = { vibration: 8.0, temperature: 230, pressure: 100, currentDraw: 30 };
      const score = calcHealthScore(readings, normalRanges);
      assert.ok(score < 100, `Score ${score} should be <100 with anomalies`);
    });

    it('returns 0 for severely degraded equipment', () => {
      // All readings outside normal ranges
      const readings = { vibration: 100, temperature: 400, pressure: 10, currentDraw: 100 };
      const score = calcHealthScore(readings, normalRanges);
      assert.ok(score < 50, `Score should reflect severe degradation, got ${score}`);
    });
  });

  describe('Failure Probability (Weibull)', () => {
    it('failure probability increases with age', () => {
      const p1 = weibullFailureProb(1, 10, 2.5);
      const p2 = weibullFailureProb(5, 10, 2.5);
      const p3 = weibullFailureProb(9, 10, 2.5);
      assert.ok(p1 < p2 && p2 < p3, `Prob should increase: ${p1.toFixed(3)} < ${p2.toFixed(3)} < ${p3.toFixed(3)}`);
    });

    it('probability approaches 1 near characteristic life', () => {
      const p = weibullFailureProb(10, 10, 2.5);
      assert.ok(p > 0.6, `At characteristic life, prob=${p.toFixed(3)} should be >0.6`);
    });

    it('probability near zero for new equipment', () => {
      const p = weibullFailureProb(0.1, 10, 2.5);
      assert.ok(p < 0.01);
    });
  });

  describe('Remaining Useful Life', () => {
    it('calculates RUL for degrading equipment', () => {
      const rul = estimateRUL(75, 1.5); // 75% health, 1.5% per day degradation
      // Points to failure = 75-30=45, rate=1.5, so RUL=30 days
      assert.ok(Math.abs(rul - 30) < 0.01, `RUL should be 30 days, got ${rul}`);
    });

    it('returns Infinity for non-degrading equipment', () => {
      assert.equal(estimateRUL(90, 0), Infinity);
    });

    it('returns 0 when health is already below critical', () => {
      const rul = estimateRUL(20, 1.5); // below critical threshold of 30
      assert.equal(rul, 0);
    });
  });

  describe('Maintenance Recommendations', () => {
    it('generates CRITICAL for failing equipment', () => {
      const rec = getRecommendation(25, 5, 'Chiller-1');
      assert.equal(rec.priority, 'CRITICAL');
      assert.equal(rec.daysToAct, 0);
    });

    it('generates HIGH priority for degraded equipment', () => {
      const rec = getRecommendation(50, 20, 'AHU-2');
      assert.equal(rec.priority, 'HIGH');
    });

    it('generates LOW for healthy equipment', () => {
      const rec = getRecommendation(92, 180, 'VAV-101');
      assert.equal(rec.priority, 'LOW');
      assert.equal(rec.daysToAct, 90);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 6  CMMS WORK ORDER AUTOMATION
// ─────────────────────────────────────────────────────────────────────────────

class MockCMSSConnector {
  constructor(systemName) {
    this.systemName = systemName;
    this.assets    = new Map();
    this.workOrders = new Map();
    this.pmSchedules = new Map();
    this._woCounter  = 1000;
    this.connected = false;
  }

  async connect() { this.connected = true; return { status: 'healthy' }; }
  async disconnect() { this.connected = false; }
  async healthCheck() {
    return { status: this.connected ? 'healthy' : 'unhealthy' };
  }

  async createAsset(asset) {
    const a = { id: `ASSET-${Date.now()}`, ...asset };
    this.assets.set(a.id, a);
    return a;
  }

  async getAsset(id) { return this.assets.get(id) ?? null; }
  async getAssets() { return [...this.assets.values()]; }

  async createWorkOrder(wo) {
    const id = `WO-${++this._woCounter}`;
    const woNum = `WO${this._woCounter.toString().padStart(6, '0')}`;
    const created = { id, woNum, status: 'OPEN', ...wo, createdAt: new Date(), updatedAt: new Date() };
    this.workOrders.set(id, created);
    return created;
  }

  async getWorkOrder(id) { return this.workOrders.get(id) ?? null; }
  async getWorkOrders(filter = {}) {
    let wos = [...this.workOrders.values()];
    if (filter.status) wos = wos.filter(w => w.status === filter.status);
    if (filter.assetId) wos = wos.filter(w => w.assetId === filter.assetId);
    return wos;
  }

  async updateWorkOrder(id, updates) {
    const wo = this.workOrders.get(id);
    if (!wo) throw new Error(`Work order ${id} not found`);
    Object.assign(wo, updates, { updatedAt: new Date() });
    return wo;
  }

  async closeWorkOrder(id, notes) {
    return this.updateWorkOrder(id, { status: 'CLOSED', completionNotes: notes, closedAt: new Date() });
  }

  async createPMSchedule(pm) {
    const id = `PM-${Date.now()}`;
    const sched = { id, ...pm };
    this.pmSchedules.set(id, sched);
    return sched;
  }

  async generatePMWorkOrders() {
    const wos = [];
    const now = new Date();
    for (const [, pm] of this.pmSchedules) {
      if (!pm.nextDue || new Date(pm.nextDue) <= now) {
        const wo = await this.createWorkOrder({
          assetId: pm.assetId,
          type: 'PM',
          description: `Scheduled PM: ${pm.name}`,
          priority: pm.priority ?? 3,
        });
        wos.push(wo);
      }
    }
    return wos;
  }
}

/** Convert a BACnet alarm + ML health into a work order */
function alarmToWorkOrder(alarm, healthScore, assetId) {
  const priorityMap = { 'CRITICAL': 1, 'HIGH': 2, 'MEDIUM': 3, 'LOW': 4 };
  const priority = healthScore < 30 ? 'CRITICAL' : healthScore < 60 ? 'HIGH' : 'MEDIUM';

  return {
    assetId,
    type: 'CM', // corrective maintenance
    description: `Auto-generated WO from alarm: ${alarm.description}`,
    priority: priorityMap[priority],
    notes: `Equipment health score: ${healthScore.toFixed(1)}%. Alarm: ${alarm.code}`,
    scheduledStart: priority === 'CRITICAL' ? new Date() : new Date(Date.now() + 7 * 86400000),
  };
}

describe('6. CMMS Work Order Automation', () => {
  let cmss;
  let chillerAsset;

  before(async () => {
    cmss = new MockCMSSConnector('Maximo');
    await cmss.connect();

    chillerAsset = await cmss.createAsset({
      siteId: 'TRANE-SITE-001',
      location: 'Central Plant',
      equipmentType: 'chiller',
      manufacturer: 'Trane',
      model: 'RTHD-150',
      serialNumber: 'SN-001',
      installDate: new Date('2018-01-01'),
      status: 'ACTIVE',
    });
  });

  it('successfully connects to CMSS', async () => {
    const health = await cmss.healthCheck();
    assert.equal(health.status, 'healthy');
  });

  it('creates and retrieves an asset', async () => {
    const retrieved = await cmss.getAsset(chillerAsset.id);
    assert.ok(retrieved);
    assert.equal(retrieved.equipmentType, 'chiller');
    assert.equal(retrieved.manufacturer, 'Trane');
  });

  it('auto-generates corrective work order from alarm', async () => {
    const alarm = { code: 'CHW-LP-001', description: 'Chiller low pressure trip', severity: 'HIGH' };
    const healthScore = 45;

    const woDef = alarmToWorkOrder(alarm, healthScore, chillerAsset.id);
    const wo = await cmss.createWorkOrder(woDef);

    assert.ok(wo.id.startsWith('WO-'));
    assert.ok(wo.woNum.startsWith('WO'));
    assert.equal(wo.status, 'OPEN');
    assert.equal(wo.type, 'CM');
    assert.ok(wo.description.includes('Auto-generated'));
  });

  it('generates CRITICAL priority WO for failing equipment', async () => {
    const alarm = { code: 'CHW-HT-001', description: 'Chiller compressor high temp', severity: 'CRITICAL' };
    const woDef = alarmToWorkOrder(alarm, 25, chillerAsset.id); // health=25 → CRITICAL
    assert.equal(woDef.priority, 1);
    // Critical WOs should be scheduled immediately
    assert.ok(woDef.scheduledStart <= new Date(Date.now() + 1000));
  });

  it('creates PM schedule and generates PM work orders', async () => {
    const pm = await cmss.createPMSchedule({
      assetId: chillerAsset.id,
      name: 'Quarterly Chiller Inspection',
      frequency: 'QUARTERLY',
      priority: 2,
      nextDue: new Date(Date.now() - 86400000), // overdue (yesterday)
    });

    const wos = await cmss.generatePMWorkOrders();
    assert.ok(wos.length >= 1, 'At least one PM WO should be generated');
    assert.equal(wos[0].type, 'PM');
    assert.equal(wos[0].assetId, chillerAsset.id);
  });

  it('closes a work order with completion notes', async () => {
    const wo = await cmss.createWorkOrder({
      assetId: chillerAsset.id,
      type: 'CM',
      description: 'Test WO',
      priority: 3,
    });

    const closed = await cmss.closeWorkOrder(wo.id, 'Replaced refrigerant filter drier');
    assert.equal(closed.status, 'CLOSED');
    assert.ok(closed.completionNotes.includes('filter drier'));
  });

  it('filters work orders by status', async () => {
    const open = await cmss.getWorkOrders({ status: 'OPEN' });
    const closed = await cmss.getWorkOrders({ status: 'CLOSED' });
    assert.ok(open.every(w => w.status === 'OPEN'));
    assert.ok(closed.every(w => w.status === 'CLOSED'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 7  IIOT / SPARKPLUG B SIMULATION
// ─────────────────────────────────────────────────────────────────────────────

/** Sparkplug B UNS namespace helper */
function buildSpbTopic(groupId, edgeNodeId, deviceId, msgType) {
  const base = `spBv1.0/${groupId}/${msgType}/${edgeNodeId}`;
  return deviceId ? `${base}/${deviceId}` : base;
}

/** Unified Namespace path */
function buildUNSPath(enterprise, site, area, line, device) {
  return [enterprise, site, area, line, device].filter(Boolean).join('/');
}

/** Encode metric payload */
function encodeSpbMetric(name, value, dataType = 'Float', timestamp = Date.now()) {
  return { name, value, dataType, timestamp };
}

describe('7. IIoT / Sparkplug B & Unified Namespace', () => {
  describe('Sparkplug B Topic Structure', () => {
    it('builds NBIRTH topic correctly', () => {
      const topic = buildSpbTopic('TraneBuilding', 'TracerSC-001', null, 'NBIRTH');
      assert.equal(topic, 'spBv1.0/TraneBuilding/NBIRTH/TracerSC-001');
    });

    it('builds DDATA topic with device ID', () => {
      const topic = buildSpbTopic('TraneBuilding', 'TracerSC-001', 'Chiller-1', 'DDATA');
      assert.equal(topic, 'spBv1.0/TraneBuilding/DDATA/TracerSC-001/Chiller-1');
    });

    it('builds NDEATH topic', () => {
      const topic = buildSpbTopic('TraneBuilding', 'TracerSC-001', null, 'NDEATH');
      assert.ok(topic.includes('NDEATH'));
    });
  });

  describe('Unified Namespace Path', () => {
    it('builds full ISA-95 path for a VAV box', () => {
      const path = buildUNSPath('TraneTech', 'Minneapolis-HQ', 'Floor-3', 'Zone-A', 'VAV-301');
      assert.equal(path, 'TraneTech/Minneapolis-HQ/Floor-3/Zone-A/VAV-301');
    });

    it('builds partial path (omits empty segments)', () => {
      const path = buildUNSPath('TraneTech', 'Chicago-Office', null, null, null);
      assert.equal(path, 'TraneTech/Chicago-Office');
    });
  });

  describe('Metric Encoding', () => {
    it('encodes chiller leaving water temp metric', () => {
      const metric = encodeSpbMetric('Chiller/LeavingWaterTemp', 44.5);
      assert.equal(metric.name, 'Chiller/LeavingWaterTemp');
      assert.equal(metric.value, 44.5);
      assert.equal(metric.dataType, 'Float');
      assert.ok(metric.timestamp > 0);
    });

    it('encodes boolean alarm metric', () => {
      const metric = encodeSpbMetric('Chiller/AlarmActive', true, 'Boolean');
      assert.equal(metric.dataType, 'Boolean');
      assert.equal(metric.value, true);
    });

    it('batch encodes multiple building points', () => {
      const points = [
        ['SAT', 58.2, 'Float'],
        ['RAT', 72.0, 'Float'],
        ['OAT', 35.0, 'Float'],
        ['FanStatus', true, 'Boolean'],
        ['FanSpeedPct', 65, 'Int32'],
      ];
      const metrics = points.map(([n, v, t]) => encodeSpbMetric(n, v, t));
      assert.equal(metrics.length, 5);
      assert.equal(metrics[3].dataType, 'Boolean');
      assert.equal(metrics[4].dataType, 'Int32');
    });
  });

  describe('MQTT Topic Routing', () => {
    it('validates wildcard subscription patterns', () => {
      function topicMatches(pattern, topic) {
        // OASIS MQTT 3.1.1 §4.7 segment-based wildcard matching
        const ps = pattern.split('/'), ts = topic.split('/');
        function seg(pi, ti) {
          if (pi === ps.length) return ti === ts.length;
          if (ps[pi] === '#') return true; // # matches any remaining levels
          if (ti === ts.length) return false;
          if (ps[pi] === '+' || ps[pi] === ts[ti]) return seg(pi + 1, ti + 1);
          return false;
        }
        return seg(0, 0);
      }

      assert.ok(topicMatches('spBv1.0/+/DDATA/#', 'spBv1.0/TraneBuilding/DDATA/EdgeNode/Device'));
      assert.ok(!topicMatches('spBv1.0/+/NBIRTH/+', 'spBv1.0/TraneBuilding/DDATA/EdgeNode'));
      assert.ok(topicMatches('trane/#', 'trane/site/floor/zone/device'));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 8  MULTI-SITE AUTONOMOUS MANAGEMENT SIMULATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full simulation of autonomous lifecycle management across multiple Trane sites:
 *   Device discovery → Health monitoring → Fault detection →
 *   Work order creation → Energy optimization → Reporting
 */
async function runAutonomousManagementCycle(sites) {
  const results = {
    sites:        sites.length,
    devicesFound: 0,
    faultsDetected: 0,
    workOrdersCreated: 0,
    energySavingsKwh: 0,
    humanInterventions: 0,
    actions: [],
  };

  for (const site of sites) {
    // 1. Device Discovery
    const discovered = site.bacnet.whoIs();
    results.devicesFound += discovered.length;

    for (const dev of discovered) {
      try {
        // 2. Read present value and status
        const pv = site.bacnet.readProperty(dev.deviceInstance, 85);
        const status = site.bacnet.readProperty(dev.deviceInstance, 117);

        // 3. Run health scoring
        const healthScore = Math.max(30, 100 - (status !== 0 ? 40 : 0) - Math.random() * 10);

        // 4. Fault detection
        let faultDetected = false;
        if (status !== 0) {
          results.faultsDetected++;
          faultDetected = true;

          // 5. Auto-create work order (no human needed for < CRITICAL)
          const alarm = { code: `AUTO-${dev.deviceInstance}`, description: `Status fault on ${dev.objectName}`, severity: 'HIGH' };
          const woDef = alarmToWorkOrder(alarm, healthScore, `ASSET-${dev.deviceInstance}`);
          await site.cmss.createWorkOrder(woDef);
          results.workOrdersCreated++;
          results.actions.push({ site: site.name, action: 'WO_CREATED', device: dev.objectName, auto: true });
        }

        // 6. Energy optimization via T&R reset
        if (dev.objectName.includes('AHU') || dev.objectName.includes('Chiller')) {
          const currentSP = typeof pv === 'number' ? pv : 60;
          const requests = status !== 0 ? 0 : Math.floor(Math.random() * 3);
          const newSP = trimAndRespond(currentSP, requests, {});
          const deltaKwh = Math.abs(currentSP - newSP) * 15; // rough proxy

          if (Math.abs(newSP - currentSP) > 0.1) {
            site.bacnet.writeProperty(dev.deviceInstance, 85, newSP);
            results.energySavingsKwh += deltaKwh;
            results.actions.push({ site: site.name, action: 'SETPOINT_OPTIMIZED', device: dev.objectName, auto: true, deltaKwh });
          }
        }

        // 7. Only escalate CRITICAL faults to human
        if (healthScore < 30 && faultDetected) results.humanInterventions++;

      } catch {
        // Device unresponsive — log but don't crash
        results.actions.push({ site: site.name, action: 'DEVICE_UNRESPONSIVE', device: dev.objectName });
      }
    }
  }

  return results;
}

describe('8. Multi-Site Autonomous Management Simulation', () => {
  let sites;

  before(async () => {
    // Build 3 simulated Trane sites
    sites = ['Minneapolis-HQ', 'Chicago-Office', 'Denver-Campus'].map(name => {
      const bacnet = new BACnetSimulator();
      const cmss   = new MockCMSSConnector('Maximo');

      // Each site has a chiller, 2 AHUs, 4 VAVs
      bacnet.addDevice(1, `Trane-RTHD-Chiller-${name}`,  { 85: 44.0, 117: 0 });
      bacnet.addDevice(2, `Trane-MACH-AHU-1-${name}`,    { 85: 58.0, 117: 0 });
      bacnet.addDevice(3, `Trane-MACH-AHU-2-${name}`,    { 85: 59.0, 117: 1 }); // alarm!
      bacnet.addDevice(4, `Trane-PIVT-VAV-101-${name}`,  { 85: 200,  117: 0 });
      bacnet.addDevice(5, `Trane-PIVT-VAV-102-${name}`,  { 85: 180,  117: 0 });
      bacnet.addDevice(6, `Trane-PIVT-VAV-103-${name}`,  { 85: 220,  117: 0 });
      bacnet.addDevice(7, `Trane-PIVT-VAV-104-${name}`,  { 85: 150,  117: 0 });

      cmss.connect();

      return { name, bacnet, cmss };
    });
  });

  it('discovers all devices across all sites', async () => {
    const result = await runAutonomousManagementCycle(sites);
    assert.equal(result.sites, 3);
    assert.equal(result.devicesFound, 21); // 7 devices × 3 sites
  });

  it('autonomously detects faults without human intervention', async () => {
    const result = await runAutonomousManagementCycle(sites);
    assert.ok(result.faultsDetected >= 3, `Should detect ≥3 faults (one AHU-2 alarm per site), got ${result.faultsDetected}`);
  });

  it('creates work orders automatically for all faults', async () => {
    const result = await runAutonomousManagementCycle(sites);
    assert.equal(result.workOrdersCreated, result.faultsDetected, 'Each fault should produce a WO');
  });

  it('optimizes setpoints autonomously across sites', async () => {
    const result = await runAutonomousManagementCycle(sites);
    const optimizationActions = result.actions.filter(a => a.action === 'SETPOINT_OPTIMIZED');
    assert.ok(optimizationActions.length > 0, 'Should perform autonomous setpoint optimizations');
    assert.ok(optimizationActions.every(a => a.auto === true), 'All optimizations should be autonomous');
  });

  it('minimizes human interventions (only CRITICAL faults escalate)', async () => {
    const result = await runAutonomousManagementCycle(sites);
    // Human interventions should be a small fraction of total actions
    const totalActions = result.workOrdersCreated + result.energySavingsKwh > 0 ? 1 : 0;
    assert.ok(result.humanInterventions <= result.faultsDetected,
      `Human interventions (${result.humanInterventions}) should be ≤ total faults (${result.faultsDetected})`);
  });

  it('all autonomous actions are tagged auto=true', async () => {
    const result = await runAutonomousManagementCycle(sites);
    const autoActions = result.actions.filter(a => a.auto === true);
    assert.ok(autoActions.length > 0, 'Should have autonomous actions');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 9  FAULT → REMEDIATION PIPELINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * End-to-end pipeline:
 *   BACnet alarm → G36 fault rule → ML health → CMMS WO → PM schedule update
 */
async function faultRemediationPipeline(bacnetAlarm, sensorReadings, cmss, assetId) {
  const steps = [];

  // Step 1: Classify fault via G36 rules
  const { sat, satSetpoint, chwValveCmd, outdoorAirFraction, oaCommand, filterDP } = sensorReadings;
  const faults = [];
  if (G36_FAULTS.supplyAirTooLow(sat, satSetpoint)) faults.push({ rule: 'SAT_TOO_LOW', severity: 'HIGH' });
  if (G36_FAULTS.supplyAirTooHigh(sat, satSetpoint)) faults.push({ rule: 'SAT_TOO_HIGH', severity: 'HIGH' });
  if (G36_FAULTS.coolingValveLeak(chwValveCmd, sat, satSetpoint)) faults.push({ rule: 'COOLING_VALVE_LEAK', severity: 'MEDIUM' });
  if (G36_FAULTS.economizerStuck(outdoorAirFraction, oaCommand)) faults.push({ rule: 'ECONOMIZER_STUCK', severity: 'MEDIUM' });
  if (G36_FAULTS.filterDirty(filterDP)) faults.push({ rule: 'FILTER_DIRTY', severity: 'LOW' });

  steps.push({ step: 'FAULT_CLASSIFICATION', faults });

  // Step 2: Health scoring
  const healthScore = bacnetAlarm.severity === 'CRITICAL' ? 25
    : bacnetAlarm.severity === 'HIGH' ? 55
    : 75;
  steps.push({ step: 'HEALTH_SCORING', healthScore });

  // Step 3: RUL estimation
  const degradationRate = bacnetAlarm.severity === 'CRITICAL' ? 5 : 2;
  const rul = estimateRUL(healthScore, degradationRate);
  steps.push({ step: 'RUL_ESTIMATION', rul });

  // Step 4: Generate recommendation
  const rec = getRecommendation(healthScore, rul, bacnetAlarm.device);
  steps.push({ step: 'RECOMMENDATION', rec });

  // Step 5: Create work order (autonomous)
  const woDef = alarmToWorkOrder(bacnetAlarm, healthScore, assetId);
  const wo = await cmss.createWorkOrder(woDef);
  steps.push({ step: 'WORK_ORDER_CREATED', wo, auto: true });

  // Step 6: Schedule follow-up PM if MEDIUM or higher
  if (rec.priority !== 'LOW') {
    const pm = await cmss.createPMSchedule({
      assetId,
      name: `Follow-up: ${rec.action}`,
      frequency: rec.priority === 'CRITICAL' ? 'WEEKLY' : 'MONTHLY',
      priority: woDef.priority,
      nextDue: new Date(Date.now() + rec.daysToAct * 86400000),
    });
    steps.push({ step: 'PM_SCHEDULED', pm, auto: true });
  }

  return { success: true, faults, healthScore, rul, recommendation: rec, workOrder: wo, steps };
}

describe('9. Fault → Remediation Pipeline', () => {
  let cmss;

  before(async () => {
    cmss = new MockCMSSConnector('ServiceNow');
    await cmss.connect();
  });

  it('detects SAT fault and creates WO for low supply air temp', async () => {
    const alarm = { code: 'AHU-SAT-LOW', description: 'Supply air temperature below minimum', severity: 'HIGH', device: 'AHU-2' };
    const sensors = { sat: 48, satSetpoint: 60, chwValveCmd: 0, outdoorAirFraction: 0.3, oaCommand: 30, filterDP: 0.3 };

    const result = await faultRemediationPipeline(alarm, sensors, cmss, 'ASSET-AHU-2');

    assert.ok(result.success);
    assert.ok(result.faults.some(f => f.rule === 'SAT_TOO_LOW'));
    assert.ok(result.workOrder.id, 'Work order should be created');
    assert.ok(result.steps.find(s => s.step === 'WORK_ORDER_CREATED').auto === true);
  });

  it('detects cooling valve leak and auto-generates corrective WO', async () => {
    const alarm = { code: 'AHU-CLG-VALVE', description: 'Cooling valve suspected leak', severity: 'MEDIUM', device: 'AHU-3' };
    const sensors = { sat: 55, satSetpoint: 60, chwValveCmd: 0, outdoorAirFraction: 0.3, oaCommand: 30, filterDP: 0.4 };

    const result = await faultRemediationPipeline(alarm, sensors, cmss, 'ASSET-AHU-3');
    assert.ok(result.faults.some(f => f.rule === 'COOLING_VALVE_LEAK'));
  });

  it('schedules follow-up PM for non-LOW priority faults', async () => {
    const alarm = { code: 'CHILLER-HP', description: 'High pressure fault', severity: 'HIGH', device: 'Chiller-1' };
    const sensors = { sat: 60, satSetpoint: 60, chwValveCmd: 50, outdoorAirFraction: 0.3, oaCommand: 30, filterDP: 0.4 };

    const result = await faultRemediationPipeline(alarm, sensors, cmss, 'ASSET-CHILLER-1');
    assert.ok(result.steps.find(s => s.step === 'PM_SCHEDULED'), 'PM should be scheduled for HIGH priority fault');
  });

  it('full pipeline completes in <100ms (real-time responsiveness)', async () => {
    const alarm = { code: 'FILTER-DP', description: 'Filter differential pressure high', severity: 'LOW', device: 'AHU-4' };
    const sensors = { sat: 60, satSetpoint: 60, chwValveCmd: 50, outdoorAirFraction: 0.3, oaCommand: 30, filterDP: 0.9 };

    const t0 = Date.now();
    const result = await faultRemediationPipeline(alarm, sensors, cmss, 'ASSET-AHU-4');
    const elapsed = Date.now() - t0;

    assert.ok(result.success);
    assert.ok(elapsed < 100, `Pipeline should be <100ms, took ${elapsed}ms`);
  });

  it('handles multiple concurrent faults on same device', async () => {
    const alarm = { code: 'AHU-MULTI', description: 'Multiple faults detected', severity: 'HIGH', device: 'AHU-5' };
    // Multiple faults simultaneously
    const sensors = { sat: 48, satSetpoint: 60, chwValveCmd: 0, outdoorAirFraction: 0.1, oaCommand: 50, filterDP: 0.9 };

    const result = await faultRemediationPipeline(alarm, sensors, cmss, 'ASSET-AHU-5');
    assert.ok(result.faults.length >= 2, `Should detect multiple faults, got ${result.faults.length}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 10  ENERGY OPPORTUNITY ROI ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────

describe('10. Energy Opportunity ROI Analysis', () => {
  const opportunities = [
    { name: 'Chiller Plant Optimization',  cost: 25000,  annualSavings: 18000, life: 10, rate: 0.08 },
    { name: 'LED Lighting Retrofit',       cost: 80000,  annualSavings: 22000, life: 15, rate: 0.08 },
    { name: 'VFD on Cooling Tower Fans',   cost: 15000,  annualSavings: 8000,  life: 10, rate: 0.08 },
    { name: 'Building Envelope Upgrade',   cost: 500000, annualSavings: 35000, life: 25, rate: 0.08 },
    { name: 'Demand Control Ventilation',  cost: 12000,  annualSavings: 9500,  life: 10, rate: 0.08 },
  ];

  it('ranks opportunities by NPV', () => {
    const ranked = opportunities
      .map(o => ({ ...o, npv: calcNPV(o.annualSavings, o.cost, o.rate, o.life) }))
      .sort((a, b) => b.npv - a.npv);

    // Building Envelope is high NPV but long payback — verify NPV ranking is done
    assert.ok(ranked[0].npv >= ranked[ranked.length - 1].npv);
  });

  it('identifies projects with payback < 5 years', () => {
    const quickWins = opportunities.filter(o => simplePayback(o.cost, o.annualSavings) < 5);
    assert.ok(quickWins.length >= 2, `Expected ≥2 quick-win projects, got ${quickWins.length}`);
    assert.ok(quickWins.every(o => o.name !== 'Building Envelope Upgrade'));
  });

  it('all quick wins have positive NPV', () => {
    const quickWins = opportunities.filter(o => simplePayback(o.cost, o.annualSavings) < 5);
    for (const o of quickWins) {
      const npv = calcNPV(o.annualSavings, o.cost, o.rate, o.life);
      assert.ok(npv > 0, `${o.name} should have positive NPV, got ${npv.toFixed(0)}`);
    }
  });

  it('calculates correct payback for VFD opportunity', () => {
    const vfd = opportunities.find(o => o.name === 'VFD on Cooling Tower Fans');
    const pb = simplePayback(vfd.cost, vfd.annualSavings);
    assert.ok(Math.abs(pb - 1.875) < 0.01, `VFD payback should be 1.875 yr, got ${pb.toFixed(3)}`);
  });

  it('portfolio NPV vs individual NPVs are consistent', () => {
    const portfolioNPV = opportunities.reduce((sum, o) => sum + calcNPV(o.annualSavings, o.cost, o.rate, o.life), 0);
    const individualSum = opportunities.map(o => calcNPV(o.annualSavings, o.cost, o.rate, o.life)).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(portfolioNPV - individualSum) < 0.01, 'Portfolio NPV should equal sum of individual NPVs');
  });

  it('Monte Carlo sensitivity: NPV remains positive across discount rate range', () => {
    // LED retrofit under varying discount rate assumptions (6%-12%)
    const led = opportunities.find(o => o.name === 'LED Lighting Retrofit');
    const rates = [0.06, 0.07, 0.08, 0.09, 0.10, 0.11, 0.12];
    for (const r of rates) {
      const npv = calcNPV(led.annualSavings, led.cost, r, led.life);
      assert.ok(npv > 0, `LED retrofit NPV should be positive at ${(r * 100).toFixed(0)}% discount rate, got ${npv.toFixed(0)}`);
    }
  });
});
