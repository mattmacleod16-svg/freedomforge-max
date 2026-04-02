/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — ISO 50001 Energy Management System
   
   Enterprise energy management aligned with ISO 50001:2018
   
   Features:
   - Energy Performance Indicators (EnPIs)
   - Significant Energy Users (SEUs) tracking
   - Energy baselines and targets
   - Continuous improvement (PDCA)
   - Automated reporting and compliance
   - Integration with building automation
   
   Reference: ISO 50001:2018 - Energy Management Systems
   ═══════════════════════════════════════════════════════════════════════════ */

import { EventEmitter } from 'events';

// ─────────────────────────────────────────────────────────────────────────────
// ISO 50001 Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EnergySource {
  id: string;
  name: string;
  type: 'electricity' | 'natural_gas' | 'fuel_oil' | 'propane' | 'steam' | 'chilled_water' | 'hot_water' | 'solar' | 'wind' | 'other';
  unit: 'kWh' | 'therms' | 'gallons' | 'cubic_feet' | 'mmBtu' | 'tons' | 'kW' | 'MWh';
  conversionToMMBtu: number; // Conversion factor to MMBtu for normalization
  carbonIntensity: number; // kg CO2e per unit
  costPerUnit: number;
  currency: string;
}

export interface EnergyMeter {
  id: string;
  name: string;
  description?: string;
  sourceId: string; // Reference to EnergySource
  location: {
    siteId: string;
    buildingId?: string;
    floorId?: string;
    zoneId?: string;
  };
  meterType: 'main' | 'sub' | 'check' | 'virtual';
  protocol: 'bacnet' | 'modbus' | 'manual' | 'api' | 'pulse';
  deviceAddress?: string;
  registerAddress?: number;
  multiplier: number;
  offset: number;
  demandInterval?: number; // minutes for demand calculation
  parentMeterId?: string; // For hierarchical metering
  isRealTime: boolean;
  lastReading?: {
    value: number;
    timestamp: Date;
    quality: 'good' | 'uncertain' | 'bad';
  };
}

export interface EnergyReading {
  meterId: string;
  timestamp: Date;
  value: number;
  unit: string;
  demand?: number; // Peak demand for the interval
  quality: 'good' | 'estimated' | 'manual' | 'calculated';
  source: 'automatic' | 'manual' | 'calculated';
  cost?: number;
  carbonEmissions?: number;
}

export interface EnergyBaseline {
  id: string;
  name: string;
  description?: string;
  scope: 'organization' | 'site' | 'building' | 'system' | 'equipment';
  scopeId?: string;
  period: {
    start: Date;
    end: Date;
  };
  energySources: string[]; // IDs of energy sources included
  totalConsumption: number; // In normalized units (e.g., MMBtu)
  variables: {
    name: string;
    type: 'weather' | 'occupancy' | 'production' | 'schedule' | 'other';
    value: number;
    unit: string;
    coefficient?: number;
  }[];
  model?: {
    type: 'linear' | 'multivariate' | 'degree_day' | 'custom';
    equation: string;
    r_squared: number;
    cv_rmse: number;
  };
  createdAt: Date;
  createdBy: string;
  approvedAt?: Date;
  approvedBy?: string;
}

export interface EnergyTarget {
  id: string;
  name: string;
  baselineId: string;
  type: 'absolute' | 'intensity' | 'percentage';
  targetValue: number;
  unit: string;
  period: {
    start: Date;
    end: Date;
  };
  scope: 'organization' | 'site' | 'building' | 'system' | 'equipment';
  scopeId?: string;
  status: 'draft' | 'active' | 'achieved' | 'missed' | 'expired';
  progress?: number; // 0-100%
  milestones?: {
    date: Date;
    targetValue: number;
    actualValue?: number;
  }[];
}

export interface SignificantEnergyUser {
  id: string;
  name: string;
  description?: string;
  type: 'equipment' | 'system' | 'process' | 'building' | 'area';
  location: {
    siteId: string;
    buildingId?: string;
    floorId?: string;
  };
  energySources: string[];
  annualConsumption: number;
  percentageOfTotal: number;
  meters: string[];
  operatingHours?: number;
  efficiency?: number;
  ratedPower?: number;
  variableFactors: string[];
  opportunities: EnergyOpportunity[];
  lastReview: Date;
  nextReview: Date;
}

export interface EnergyOpportunity {
  id: string;
  title: string;
  description: string;
  type: 'behavioral' | 'operational' | 'equipment' | 'system' | 'process';
  category: 'lighting' | 'hvac' | 'motors' | 'compressed_air' | 'process' | 'building_envelope' | 'other';
  estimatedSavings: {
    energy: number;
    energyUnit: string;
    cost: number;
    carbon: number;
    percentage: number;
  };
  implementationCost: number;
  paybackPeriod: number; // months
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'identified' | 'evaluated' | 'approved' | 'in_progress' | 'implemented' | 'verified' | 'rejected';
  assignedTo?: string;
  dueDate?: Date;
  completedDate?: Date;
  verifiedSavings?: number;
}

export interface EnergyPerformanceIndicator {
  id: string;
  name: string;
  description?: string;
  formula: string;
  unit: string;
  scope: 'organization' | 'site' | 'building' | 'system' | 'equipment';
  scopeId?: string;
  frequency: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually';
  target?: number;
  baseline?: number;
  current?: number;
  trend: 'improving' | 'stable' | 'declining';
  status: 'on_track' | 'at_risk' | 'off_track';
}

export interface EnPIValue {
  indicatorId: string;
  timestamp: Date;
  value: number;
  numerator: number;
  denominator: number;
  baseline?: number;
  target?: number;
  normalizedValue?: number;
  variance?: number;
}

export interface EnergyAudit {
  id: string;
  type: 'internal' | 'external' | 'certification';
  scope: string[];
  period: {
    start: Date;
    end: Date;
  };
  auditor: string;
  status: 'planned' | 'in_progress' | 'completed' | 'closed';
  findings: {
    id: string;
    category: 'conformity' | 'minor_nc' | 'major_nc' | 'opportunity';
    description: string;
    requirement?: string;
    evidence?: string;
    correctiveAction?: string;
    dueDate?: Date;
    status: 'open' | 'in_progress' | 'closed' | 'verified';
  }[];
  recommendations: string[];
  overallConclusion?: string;
  completedAt?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Energy Performance Calculator
// ─────────────────────────────────────────────────────────────────────────────

export class EnergyPerformanceCalculator {
  private degreeDayBase: { heating: number; cooling: number } = { heating: 65, cooling: 65 };

  /**
   * Calculate heating degree days
   */
  calculateHDD(avgTemp: number, baseTemp?: number): number {
    const base = baseTemp ?? this.degreeDayBase.heating;
    return Math.max(0, base - avgTemp);
  }

  /**
   * Calculate cooling degree days
   */
  calculateCDD(avgTemp: number, baseTemp?: number): number {
    const base = baseTemp ?? this.degreeDayBase.cooling;
    return Math.max(0, avgTemp - base);
  }

  /**
   * Calculate energy use intensity (EUI)
   */
  calculateEUI(totalEnergy: number, squareFootage: number): number {
    if (squareFootage <= 0) return 0;
    return totalEnergy / squareFootage;
  }

  /**
   * Calculate energy cost intensity
   */
  calculateECI(totalCost: number, squareFootage: number): number {
    if (squareFootage <= 0) return 0;
    return totalCost / squareFootage;
  }

  /**
   * Calculate power factor
   */
  calculatePowerFactor(realPower: number, apparentPower: number): number {
    if (apparentPower <= 0) return 0;
    return realPower / apparentPower;
  }

  /**
   * Calculate motor efficiency
   */
  calculateMotorEfficiency(outputPower: number, inputPower: number): number {
    if (inputPower <= 0) return 0;
    return (outputPower / inputPower) * 100;
  }

  /**
   * Calculate chiller efficiency (kW/ton)
   */
  calculateChillerEfficiency(inputPower: number, coolingTons: number): number {
    if (coolingTons <= 0) return 0;
    return inputPower / coolingTons;
  }

  /**
   * Calculate boiler efficiency
   */
  calculateBoilerEfficiency(outputBtu: number, inputBtu: number): number {
    if (inputBtu <= 0) return 0;
    return (outputBtu / inputBtu) * 100;
  }

  /**
   * Weather normalize energy consumption using regression
   */
  weatherNormalize(
    actualConsumption: number,
    actualDegreedays: number,
    normalDegreedays: number,
    baseLoad: number,
    weatherSensitivity: number
  ): number {
    // E_normalized = E_base + sensitivity * (DD_normal - DD_actual) + E_actual - E_base - sensitivity * DD_actual
    return baseLoad + weatherSensitivity * normalDegreedays + 
           (actualConsumption - baseLoad - weatherSensitivity * actualDegreedays);
  }

  /**
   * Calculate CV(RMSE) for baseline model validation
   */
  calculateCVRMSE(actual: number[], predicted: number[]): number {
    if (actual.length !== predicted.length || actual.length === 0) return 0;
    
    const n = actual.length;
    const mean = actual.reduce((a, b) => a + b, 0) / n;
    
    let sumSquaredErrors = 0;
    for (let i = 0; i < n; i++) {
      sumSquaredErrors += Math.pow(actual[i] - predicted[i], 2);
    }
    
    const rmse = Math.sqrt(sumSquaredErrors / n);
    return (rmse / mean) * 100;
  }

  /**
   * Calculate simple payback period
   */
  calculatePayback(implementationCost: number, annualSavings: number): number {
    if (annualSavings <= 0) return Infinity;
    return (implementationCost / annualSavings) * 12; // months
  }

  /**
   * Calculate ROI
   */
  calculateROI(annualSavings: number, implementationCost: number, projectLife: number): number {
    if (implementationCost <= 0) return 0;
    const totalSavings = annualSavings * projectLife;
    return ((totalSavings - implementationCost) / implementationCost) * 100;
  }

  /**
   * Calculate Net Present Value
   */
  calculateNPV(annualSavings: number, implementationCost: number, projectLife: number, discountRate: number): number {
    let npv = -implementationCost;
    for (let year = 1; year <= projectLife; year++) {
      npv += annualSavings / Math.pow(1 + discountRate, year);
    }
    return npv;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ISO 50001 Compliance Engine
// ─────────────────────────────────────────────────────────────────────────────

export interface ISO50001Config {
  organizationName: string;
  organizationScope: string;
  sites: string[];
  energySources: EnergySource[];
  significanceThreshold: number; // % of total to qualify as SEU
  targetReductionPerYear: number; // % annual reduction target
  reportingFrequency: 'monthly' | 'quarterly' | 'annually';
  weatherStation?: string;
  currencyCode: string;
}

export class ISO50001Engine extends EventEmitter {
  private config: ISO50001Config;
  private calculator: EnergyPerformanceCalculator;
  private meters: Map<string, EnergyMeter> = new Map();
  private readings: Map<string, EnergyReading[]> = new Map();
  private baselines: Map<string, EnergyBaseline> = new Map();
  private targets: Map<string, EnergyTarget> = new Map();
  private seus: Map<string, SignificantEnergyUser> = new Map();
  private indicators: Map<string, EnergyPerformanceIndicator> = new Map();
  private opportunities: Map<string, EnergyOpportunity> = new Map();
  private audits: Map<string, EnergyAudit> = new Map();

  constructor(config: ISO50001Config) {
    super();
    this.config = config;
    this.calculator = new EnergyPerformanceCalculator();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Meter Management
  // ─────────────────────────────────────────────────────────────────────────

  registerMeter(meter: EnergyMeter): void {
    this.meters.set(meter.id, meter);
    this.readings.set(meter.id, []);
    this.emit('meter-registered', meter);
  }

  recordReading(reading: EnergyReading): void {
    const readings = this.readings.get(reading.meterId);
    if (!readings) {
      throw new Error(`Meter ${reading.meterId} not found`);
    }

    // Calculate cost and emissions
    const meter = this.meters.get(reading.meterId);
    if (meter) {
      const source = this.config.energySources.find(s => s.id === meter.sourceId);
      if (source) {
        reading.cost = reading.value * source.costPerUnit;
        reading.carbonEmissions = reading.value * source.carbonIntensity;
      }
    }

    readings.push(reading);
    this.emit('reading-recorded', reading);

    // Check for anomalies
    this.checkAnomalies(reading);
  }

  private checkAnomalies(reading: EnergyReading): void {
    const readings = this.readings.get(reading.meterId);
    if (!readings || readings.length < 10) return;

    // Calculate rolling average and standard deviation
    const recent = readings.slice(-30);
    const mean = recent.reduce((a, b) => a + b.value, 0) / recent.length;
    const stdDev = Math.sqrt(
      recent.reduce((a, b) => a + Math.pow(b.value - mean, 2), 0) / recent.length
    );

    // Check if current reading is an outlier (>3 standard deviations)
    if (Math.abs(reading.value - mean) > 3 * stdDev) {
      this.emit('anomaly-detected', {
        meterId: reading.meterId,
        value: reading.value,
        expected: mean,
        deviation: (reading.value - mean) / stdDev,
        timestamp: reading.timestamp,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Baseline Management
  // ─────────────────────────────────────────────────────────────────────────

  createBaseline(baseline: EnergyBaseline): EnergyBaseline {
    // Calculate total consumption for the baseline period
    let totalConsumption = 0;
    for (const [meterId, readings] of this.readings) {
      const meter = this.meters.get(meterId);
      if (!meter) continue;

      const relevantReadings = readings.filter(r =>
        r.timestamp >= baseline.period.start &&
        r.timestamp <= baseline.period.end
      );

      const meterTotal = relevantReadings.reduce((a, b) => a + b.value, 0);
      
      // Convert to normalized units
      const source = this.config.energySources.find(s => s.id === meter.sourceId);
      if (source) {
        totalConsumption += meterTotal * source.conversionToMMBtu;
      }
    }

    baseline.totalConsumption = totalConsumption;
    baseline.createdAt = new Date();

    this.baselines.set(baseline.id, baseline);
    this.emit('baseline-created', baseline);

    return baseline;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Significant Energy User (SEU) Identification
  // ─────────────────────────────────────────────────────────────────────────

  identifySEUs(period: { start: Date; end: Date }): SignificantEnergyUser[] {
    // Calculate total energy consumption
    let totalEnergy = 0;
    const meterEnergy = new Map<string, number>();

    for (const [meterId, readings] of this.readings) {
      const relevantReadings = readings.filter(r =>
        r.timestamp >= period.start && r.timestamp <= period.end
      );
      const meterTotal = relevantReadings.reduce((a, b) => a + b.value, 0);
      meterEnergy.set(meterId, meterTotal);
      totalEnergy += meterTotal;
    }

    // Identify SEUs (energy users above threshold)
    const seus: SignificantEnergyUser[] = [];
    for (const [meterId, energy] of meterEnergy) {
      const percentage = (energy / totalEnergy) * 100;
      if (percentage >= this.config.significanceThreshold) {
        const meter = this.meters.get(meterId);
        if (meter) {
          const seu: SignificantEnergyUser = {
            id: `seu-${meterId}`,
            name: meter.name,
            description: `Significant energy user identified from meter ${meter.name}`,
            type: 'equipment',
            location: meter.location,
            energySources: [meter.sourceId],
            annualConsumption: energy,
            percentageOfTotal: percentage,
            meters: [meterId],
            variableFactors: [],
            opportunities: [],
            lastReview: new Date(),
            nextReview: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          };
          seus.push(seu);
          this.seus.set(seu.id, seu);
        }
      }
    }

    this.emit('seus-identified', seus);
    return seus;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Energy Performance Indicators (EnPIs)
  // ─────────────────────────────────────────────────────────────────────────

  createEnPI(indicator: EnergyPerformanceIndicator): void {
    this.indicators.set(indicator.id, indicator);
    this.emit('enpi-created', indicator);
  }

  calculateEnPI(indicatorId: string, period: { start: Date; end: Date }): EnPIValue | null {
    const indicator = this.indicators.get(indicatorId);
    if (!indicator) return null;

    // Calculate based on formula
    // This is a simplified implementation - real implementation would parse and evaluate the formula
    let numerator = 0;
    let denominator = 1;

    // Example: EUI = Total Energy / Square Footage
    for (const [meterId, readings] of this.readings) {
      const relevantReadings = readings.filter(r =>
        r.timestamp >= period.start && r.timestamp <= period.end
      );
      numerator += relevantReadings.reduce((a, b) => a + b.value, 0);
    }

    // In a real implementation, denominator would come from a data source
    // For now, use 1 to avoid division by zero
    denominator = 100000; // Example: 100,000 sq ft

    const value = numerator / denominator;
    
    const enpiValue: EnPIValue = {
      indicatorId,
      timestamp: new Date(),
      value,
      numerator,
      denominator,
      baseline: indicator.baseline,
      target: indicator.target,
      variance: indicator.baseline ? ((value - indicator.baseline) / indicator.baseline) * 100 : undefined,
    };

    // Update indicator status
    if (indicator.target) {
      indicator.current = value;
      if (value <= indicator.target) {
        indicator.status = 'on_track';
        indicator.trend = 'improving';
      } else if (value <= indicator.target * 1.1) {
        indicator.status = 'at_risk';
        indicator.trend = 'stable';
      } else {
        indicator.status = 'off_track';
        indicator.trend = 'declining';
      }
    }

    this.emit('enpi-calculated', enpiValue);
    return enpiValue;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Energy Opportunity Management
  // ─────────────────────────────────────────────────────────────────────────

  addOpportunity(opportunity: EnergyOpportunity): void {
    // Calculate payback period
    if (opportunity.implementationCost && opportunity.estimatedSavings.cost) {
      opportunity.paybackPeriod = this.calculator.calculatePayback(
        opportunity.implementationCost,
        opportunity.estimatedSavings.cost
      );
    }

    this.opportunities.set(opportunity.id, opportunity);
    this.emit('opportunity-added', opportunity);
  }

  updateOpportunityStatus(
    opportunityId: string,
    status: EnergyOpportunity['status'],
    verifiedSavings?: number
  ): void {
    const opportunity = this.opportunities.get(opportunityId);
    if (!opportunity) return;

    opportunity.status = status;
    if (status === 'verified' && verifiedSavings !== undefined) {
      opportunity.verifiedSavings = verifiedSavings;
      opportunity.completedDate = new Date();
    }

    this.emit('opportunity-updated', opportunity);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Reporting
  // ─────────────────────────────────────────────────────────────────────────

  generateEnergyReport(period: { start: Date; end: Date }): {
    summary: {
      totalConsumption: number;
      totalCost: number;
      totalEmissions: number;
      eui?: number;
    };
    bySource: Map<string, { consumption: number; cost: number; emissions: number }>;
    bySite: Map<string, { consumption: number; cost: number; emissions: number }>;
    seus: SignificantEnergyUser[];
    indicators: EnPIValue[];
    opportunities: {
      identified: number;
      implemented: number;
      savings: number;
    };
    complianceStatus: {
      baselineSet: boolean;
      targetsSet: boolean;
      seusIdentified: boolean;
      enpisTracked: boolean;
      auditsCompleted: number;
    };
    generatedAt: Date;
  } {
    // Calculate totals by source
    const bySource = new Map<string, { consumption: number; cost: number; emissions: number }>();
    const bySite = new Map<string, { consumption: number; cost: number; emissions: number }>();
    let totalConsumption = 0;
    let totalCost = 0;
    let totalEmissions = 0;

    for (const [meterId, readings] of this.readings) {
      const meter = this.meters.get(meterId);
      if (!meter) continue;

      const relevantReadings = readings.filter(r =>
        r.timestamp >= period.start && r.timestamp <= period.end
      );

      const meterTotal = relevantReadings.reduce((a, b) => a + b.value, 0);
      const meterCost = relevantReadings.reduce((a, b) => a + (b.cost || 0), 0);
      const meterEmissions = relevantReadings.reduce((a, b) => a + (b.carbonEmissions || 0), 0);

      totalConsumption += meterTotal;
      totalCost += meterCost;
      totalEmissions += meterEmissions;

      // By source
      const sourceData = bySource.get(meter.sourceId) || { consumption: 0, cost: 0, emissions: 0 };
      sourceData.consumption += meterTotal;
      sourceData.cost += meterCost;
      sourceData.emissions += meterEmissions;
      bySource.set(meter.sourceId, sourceData);

      // By site
      const siteData = bySite.get(meter.location.siteId) || { consumption: 0, cost: 0, emissions: 0 };
      siteData.consumption += meterTotal;
      siteData.cost += meterCost;
      siteData.emissions += meterEmissions;
      bySite.set(meter.location.siteId, siteData);
    }

    // Calculate EnPIs
    const indicatorValues: EnPIValue[] = [];
    for (const indicatorId of this.indicators.keys()) {
      const value = this.calculateEnPI(indicatorId, period);
      if (value) indicatorValues.push(value);
    }

    // Opportunity summary
    const allOpportunities = Array.from(this.opportunities.values());
    const implementedOpportunities = allOpportunities.filter(o => o.status === 'implemented' || o.status === 'verified');
    const verifiedSavings = implementedOpportunities.reduce((a, b) => a + (b.verifiedSavings || b.estimatedSavings.cost), 0);

    // Compliance status
    const completedAudits = Array.from(this.audits.values()).filter(a => a.status === 'completed' || a.status === 'closed');

    return {
      summary: {
        totalConsumption,
        totalCost,
        totalEmissions,
      },
      bySource,
      bySite,
      seus: Array.from(this.seus.values()),
      indicators: indicatorValues,
      opportunities: {
        identified: allOpportunities.length,
        implemented: implementedOpportunities.length,
        savings: verifiedSavings,
      },
      complianceStatus: {
        baselineSet: this.baselines.size > 0,
        targetsSet: this.targets.size > 0,
        seusIdentified: this.seus.size > 0,
        enpisTracked: this.indicators.size > 0,
        auditsCompleted: completedAudits.length,
      },
      generatedAt: new Date(),
    };
  }

  generateManagementReview(): {
    energyPolicy: string;
    performanceSummary: object;
    targetProgress: object[];
    nonConformances: object[];
    opportunities: EnergyOpportunity[];
    resourceRequirements: string[];
    continualImprovement: string[];
    actions: object[];
    generatedAt: Date;
  } {
    const targets = Array.from(this.targets.values());
    const opportunities = Array.from(this.opportunities.values());
    const audits = Array.from(this.audits.values());

    // Collect non-conformances from audits
    const nonConformances = audits.flatMap(a =>
      a.findings.filter(f => f.category === 'minor_nc' || f.category === 'major_nc')
    );

    return {
      energyPolicy: `${this.config.organizationName} is committed to continually improving energy performance, ensuring the availability of information and resources to achieve objectives, and complying with applicable requirements.`,
      performanceSummary: {
        totalMeters: this.meters.size,
        totalSEUs: this.seus.size,
        activeTargets: targets.filter(t => t.status === 'active').length,
        achievedTargets: targets.filter(t => t.status === 'achieved').length,
      },
      targetProgress: targets.map(t => ({
        id: t.id,
        name: t.name,
        target: t.targetValue,
        progress: t.progress,
        status: t.status,
      })),
      nonConformances,
      opportunities: opportunities.filter(o => o.status !== 'rejected' && o.status !== 'verified'),
      resourceRequirements: [
        'Training for energy management team',
        'Calibration of energy meters',
        'Software for energy data analysis',
      ],
      continualImprovement: [
        `Achieve ${this.config.targetReductionPerYear}% annual energy reduction`,
        'Implement identified energy conservation measures',
        'Enhance monitoring and targeting systems',
      ],
      actions: [],
      generatedAt: new Date(),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Getters
  // ─────────────────────────────────────────────────────────────────────────

  getMeters(): EnergyMeter[] {
    return Array.from(this.meters.values());
  }

  getSEUs(): SignificantEnergyUser[] {
    return Array.from(this.seus.values());
  }

  getIndicators(): EnergyPerformanceIndicator[] {
    return Array.from(this.indicators.values());
  }

  getOpportunities(): EnergyOpportunity[] {
    return Array.from(this.opportunities.values());
  }

  getBaselines(): EnergyBaseline[] {
    return Array.from(this.baselines.values());
  }

  getTargets(): EnergyTarget[] {
    return Array.from(this.targets.values());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Function
// ─────────────────────────────────────────────────────────────────────────────

export function createISO50001Engine(config: ISO50001Config): ISO50001Engine {
  return new ISO50001Engine(config);
}
