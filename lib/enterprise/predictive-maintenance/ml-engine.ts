/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — Predictive Maintenance Engine
   
   Machine learning-powered predictive maintenance for industrial HVAC equipment
   
   Features:
   - Equipment health scoring
   - Failure probability prediction
   - Anomaly detection (isolation forest, autoencoders)
   - Remaining useful life (RUL) estimation
   - Maintenance scheduling optimization
   - Integration with CMMS for work order generation
   
   Supported Equipment:
   - Chillers (centrifugal, screw, scroll)
   - Air Handling Units (AHUs)
   - Rooftop Units (RTUs)
   - Compressors
   - Pumps and fans
   - VFDs
   ═══════════════════════════════════════════════════════════════════════════ */

import { EventEmitter } from 'events';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type EquipmentCategory = 'chiller' | 'ahu' | 'rtu' | 'compressor' | 'pump' | 'fan' | 'vfd' | 'boiler' | 'cooling_tower';

export interface EquipmentProfile {
  id: string;
  name: string;
  category: EquipmentCategory;
  manufacturer: string;
  model: string;
  serialNumber: string;
  installDate: Date;
  warrantyExpiry?: Date;
  ratedCapacity: number;
  capacityUnit: string;
  location: {
    site: string;
    building: string;
    floor?: string;
    area?: string;
  };
  maintenanceHistory: MaintenanceRecord[];
  sensors: SensorConfig[];
  operatingHours: number;
  startsCount: number;
  lastMaintenanceDate?: Date;
  criticality: 'low' | 'medium' | 'high' | 'critical';
}

export interface SensorConfig {
  id: string;
  name: string;
  type: SensorType;
  unit: string;
  minValue?: number;
  maxValue?: number;
  warningLow?: number;
  warningHigh?: number;
  criticalLow?: number;
  criticalHigh?: number;
  samplingInterval: number; // seconds
}

export type SensorType =
  | 'temperature'
  | 'pressure'
  | 'vibration'
  | 'current'
  | 'voltage'
  | 'power'
  | 'flow'
  | 'level'
  | 'speed'
  | 'position'
  | 'humidity'
  | 'differential_pressure';

export interface SensorReading {
  sensorId: string;
  equipmentId: string;
  timestamp: Date;
  value: number;
  quality: 'good' | 'uncertain' | 'bad';
}

export interface MaintenanceRecord {
  id: string;
  equipmentId: string;
  type: 'preventive' | 'corrective' | 'predictive' | 'emergency';
  category: 'inspection' | 'repair' | 'replacement' | 'cleaning' | 'calibration' | 'overhaul';
  description: string;
  performedBy: string;
  startDate: Date;
  endDate: Date;
  laborHours: number;
  partsCost: number;
  laborCost: number;
  findings?: string;
  actionsPerformed: string[];
  partsReplaced?: { partNumber: string; description: string; quantity: number }[];
}

export interface HealthScore {
  equipmentId: string;
  timestamp: Date;
  overallScore: number; // 0-100
  components: {
    name: string;
    score: number;
    weight: number;
    status: 'good' | 'fair' | 'poor' | 'critical';
    trend: 'improving' | 'stable' | 'declining';
  }[];
  failureProbability: {
    next24Hours: number;
    next7Days: number;
    next30Days: number;
  };
  remainingUsefulLife?: {
    estimate: number; // days
    confidence: number; // 0-1
    lowerBound: number;
    upperBound: number;
  };
  recommendedActions: MaintenanceRecommendation[];
}

export interface MaintenanceRecommendation {
  id: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  title: string;
  description: string;
  estimatedTimeToFailure?: number; // days
  estimatedCost: number;
  potentialSavings: number;
  scheduledDate?: Date;
  deferrable: boolean;
  maxDeferDays?: number;
}

export interface Anomaly {
  id: string;
  equipmentId: string;
  sensorId?: string;
  timestamp: Date;
  type: 'point' | 'contextual' | 'collective';
  severity: 'low' | 'medium' | 'high' | 'critical';
  score: number; // 0-1, higher = more anomalous
  description: string;
  affectedMetrics: string[];
  potentialCauses: string[];
  recommendedActions: string[];
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
}

export interface FailureMode {
  id: string;
  name: string;
  description: string;
  category: EquipmentCategory;
  symptoms: {
    sensorType: SensorType;
    pattern: 'high' | 'low' | 'trending_up' | 'trending_down' | 'oscillating' | 'spike';
    threshold?: number;
    duration?: number; // minutes
  }[];
  causes: string[];
  effects: string[];
  meanTimeBetweenFailures?: number; // hours
  meanTimeToRepair?: number; // hours
  severity: 'minor' | 'moderate' | 'major' | 'catastrophic';
  preventiveActions: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Engineering
// ─────────────────────────────────────────────────────────────────────────────

export interface EngineeredFeatures {
  // Statistical features
  mean: number;
  std: number;
  min: number;
  max: number;
  range: number;
  skewness: number;
  kurtosis: number;
  
  // Trend features
  slope: number;
  intercept: number;
  rSquared: number;
  
  // Frequency domain (for vibration)
  dominantFrequency?: number;
  rmsValue?: number;
  peakToPeak?: number;
  crestFactor?: number;
  
  // Rate of change
  rateOfChange: number;
  acceleration: number;
  
  // Threshold-based
  timeAboveWarning: number;
  timeBelowWarning: number;
  crossingsCount: number;
  
  // Equipment-specific
  runTime?: number;
  cycleCount?: number;
  efficiency?: number;
}

export class FeatureEngineering {
  /**
   * Calculate statistical features from sensor readings
   */
  static calculateStatisticalFeatures(values: number[]): Partial<EngineeredFeatures> {
    if (values.length === 0) return {};

    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
    const std = Math.sqrt(variance);
    const min = Math.min(...values);
    const max = Math.max(...values);

    // Skewness
    const skewness = n > 2 
      ? values.reduce((a, b) => a + Math.pow((b - mean) / std, 3), 0) / n
      : 0;

    // Kurtosis
    const kurtosis = n > 3
      ? values.reduce((a, b) => a + Math.pow((b - mean) / std, 4), 0) / n - 3
      : 0;

    return {
      mean,
      std,
      min,
      max,
      range: max - min,
      skewness,
      kurtosis,
    };
  }

  /**
   * Calculate trend features using linear regression
   */
  static calculateTrendFeatures(values: number[], timestamps: number[]): Partial<EngineeredFeatures> {
    if (values.length < 2) return {};

    const n = values.length;
    const sumX = timestamps.reduce((a, b) => a + b, 0);
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = timestamps.reduce((a, x, i) => a + x * values[i], 0);
    const sumX2 = timestamps.reduce((a, x) => a + x * x, 0);
    const sumY2 = values.reduce((a, y) => a + y * y, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // R-squared
    const meanY = sumY / n;
    const ssTotal = sumY2 - n * meanY * meanY;
    const ssResidual = values.reduce((a, y, i) => {
      const predicted = slope * timestamps[i] + intercept;
      return a + Math.pow(y - predicted, 2);
    }, 0);
    const rSquared = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;

    return {
      slope,
      intercept,
      rSquared,
    };
  }

  /**
   * Calculate vibration-specific features
   */
  static calculateVibrationFeatures(values: number[]): Partial<EngineeredFeatures> {
    if (values.length === 0) return {};

    const n = values.length;
    const rmsValue = Math.sqrt(values.reduce((a, b) => a + b * b, 0) / n);
    const peakToPeak = Math.max(...values) - Math.min(...values);
    const peak = Math.max(...values.map(Math.abs));
    const crestFactor = peak / rmsValue;

    // Simple FFT-like dominant frequency detection (simplified)
    // In a real implementation, use proper FFT library
    let maxPower = 0;
    let dominantFrequency = 0;
    for (let f = 1; f < n / 2; f++) {
      let power = 0;
      for (let i = 0; i < n; i++) {
        power += values[i] * Math.cos(2 * Math.PI * f * i / n);
      }
      power = Math.abs(power);
      if (power > maxPower) {
        maxPower = power;
        dominantFrequency = f;
      }
    }

    return {
      rmsValue,
      peakToPeak,
      crestFactor,
      dominantFrequency,
    };
  }

  /**
   * Calculate rate of change features
   */
  static calculateRateOfChange(values: number[], timestamps: number[]): Partial<EngineeredFeatures> {
    if (values.length < 2) return {};

    const rates: number[] = [];
    for (let i = 1; i < values.length; i++) {
      const dt = (timestamps[i] - timestamps[i - 1]) / 1000; // to seconds
      if (dt > 0) {
        rates.push((values[i] - values[i - 1]) / dt);
      }
    }

    if (rates.length === 0) return {};

    const rateOfChange = rates[rates.length - 1];
    
    // Acceleration (rate of rate of change)
    let acceleration = 0;
    if (rates.length >= 2) {
      acceleration = (rates[rates.length - 1] - rates[rates.length - 2]);
    }

    return {
      rateOfChange,
      acceleration,
    };
  }

  /**
   * Calculate all features for a sensor
   */
  static extractFeatures(readings: SensorReading[], sensor: SensorConfig): EngineeredFeatures {
    const values = readings.map(r => r.value);
    const timestamps = readings.map(r => r.timestamp.getTime());

    const statistical = this.calculateStatisticalFeatures(values);
    const trend = this.calculateTrendFeatures(values, timestamps);
    const rateOfChange = this.calculateRateOfChange(values, timestamps);

    // Vibration features if applicable
    const vibration = sensor.type === 'vibration' 
      ? this.calculateVibrationFeatures(values) 
      : {};

    // Threshold-based features
    let timeAboveWarning = 0;
    let timeBelowWarning = 0;
    let crossingsCount = 0;
    let lastAbove: boolean | null = null;

    for (const value of values) {
      const above = sensor.warningHigh !== undefined && value > sensor.warningHigh;
      const below = sensor.warningLow !== undefined && value < sensor.warningLow;
      
      if (above) timeAboveWarning++;
      if (below) timeBelowWarning++;
      
      const currentAbove = above;
      if (lastAbove !== null && currentAbove !== lastAbove) {
        crossingsCount++;
      }
      lastAbove = currentAbove;
    }

    return {
      mean: statistical.mean ?? 0,
      std: statistical.std ?? 0,
      min: statistical.min ?? 0,
      max: statistical.max ?? 0,
      range: statistical.range ?? 0,
      skewness: statistical.skewness ?? 0,
      kurtosis: statistical.kurtosis ?? 0,
      slope: trend.slope ?? 0,
      intercept: trend.intercept ?? 0,
      rSquared: trend.rSquared ?? 0,
      rateOfChange: rateOfChange.rateOfChange ?? 0,
      acceleration: rateOfChange.acceleration ?? 0,
      dominantFrequency: vibration.dominantFrequency,
      rmsValue: vibration.rmsValue,
      peakToPeak: vibration.peakToPeak,
      crestFactor: vibration.crestFactor,
      timeAboveWarning,
      timeBelowWarning,
      crossingsCount,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Anomaly Detection
// ─────────────────────────────────────────────────────────────────────────────

export interface AnomalyDetectorConfig {
  method: 'isolation_forest' | 'z_score' | 'mad' | 'iqr' | 'autoencoder';
  threshold: number;
  windowSize: number;
  minSamples: number;
}

export class AnomalyDetector {
  private config: AnomalyDetectorConfig;
  private baseline: Map<string, { mean: number; std: number; q1: number; q3: number }> = new Map();

  constructor(config: AnomalyDetectorConfig) {
    this.config = config;
  }

  /**
   * Train the anomaly detector on historical data
   */
  train(sensorId: string, values: number[]): void {
    if (values.length < this.config.minSamples) return;

    const sorted = [...values].sort((a, b) => a - b);
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n);
    const q1 = sorted[Math.floor(n * 0.25)];
    const q3 = sorted[Math.floor(n * 0.75)];

    this.baseline.set(sensorId, { mean, std, q1, q3 });
  }

  /**
   * Detect anomalies in new data
   */
  detect(sensorId: string, value: number): { isAnomaly: boolean; score: number; reason?: string } {
    const baseline = this.baseline.get(sensorId);
    if (!baseline) {
      return { isAnomaly: false, score: 0 };
    }

    switch (this.config.method) {
      case 'z_score':
        return this.detectZScore(value, baseline);
      case 'mad':
        return this.detectMAD(value, baseline);
      case 'iqr':
        return this.detectIQR(value, baseline);
      case 'isolation_forest':
        return this.detectIsolationForest(value, baseline);
      default:
        return { isAnomaly: false, score: 0 };
    }
  }

  private detectZScore(value: number, baseline: { mean: number; std: number }): { isAnomaly: boolean; score: number; reason?: string } {
    if (baseline.std === 0) return { isAnomaly: false, score: 0 };

    const zScore = Math.abs((value - baseline.mean) / baseline.std);
    const isAnomaly = zScore > this.config.threshold;
    
    return {
      isAnomaly,
      score: Math.min(zScore / 5, 1), // Normalize to 0-1
      reason: isAnomaly ? `Z-score ${zScore.toFixed(2)} exceeds threshold ${this.config.threshold}` : undefined,
    };
  }

  private detectMAD(value: number, baseline: { mean: number; std: number }): { isAnomaly: boolean; score: number; reason?: string } {
    // Modified Z-score using MAD (approximated from std)
    const mad = baseline.std * 0.6745; // Approximation
    if (mad === 0) return { isAnomaly: false, score: 0 };

    const modifiedZScore = 0.6745 * Math.abs(value - baseline.mean) / mad;
    const isAnomaly = modifiedZScore > this.config.threshold;
    
    return {
      isAnomaly,
      score: Math.min(modifiedZScore / 5, 1),
      reason: isAnomaly ? `Modified Z-score ${modifiedZScore.toFixed(2)} exceeds threshold` : undefined,
    };
  }

  private detectIQR(value: number, baseline: { q1: number; q3: number }): { isAnomaly: boolean; score: number; reason?: string } {
    const iqr = baseline.q3 - baseline.q1;
    const lowerBound = baseline.q1 - this.config.threshold * iqr;
    const upperBound = baseline.q3 + this.config.threshold * iqr;
    
    const isAnomaly = value < lowerBound || value > upperBound;
    const distance = value < lowerBound 
      ? (lowerBound - value) / iqr 
      : value > upperBound 
        ? (value - upperBound) / iqr 
        : 0;
    
    return {
      isAnomaly,
      score: Math.min(distance / 3, 1),
      reason: isAnomaly 
        ? `Value ${value.toFixed(2)} outside IQR bounds [${lowerBound.toFixed(2)}, ${upperBound.toFixed(2)}]`
        : undefined,
    };
  }

  private detectIsolationForest(value: number, baseline: { mean: number; std: number }): { isAnomaly: boolean; score: number; reason?: string } {
    // Simplified isolation forest approximation
    // In a real implementation, use a proper IF library
    const deviation = Math.abs(value - baseline.mean);
    const normalizedDeviation = baseline.std > 0 ? deviation / baseline.std : 0;
    
    // Simulate path length (shorter = more anomalous)
    const pathLength = Math.max(1, 10 - normalizedDeviation);
    const score = Math.pow(2, -pathLength / 10);
    const isAnomaly = score > this.config.threshold;
    
    return {
      isAnomaly,
      score,
      reason: isAnomaly ? `Isolation score ${score.toFixed(3)} exceeds threshold` : undefined,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Health Score Calculator
// ─────────────────────────────────────────────────────────────────────────────

export class HealthScoreCalculator {
  private failureModes: Map<string, FailureMode[]> = new Map();

  /**
   * Register failure modes for an equipment category
   */
  registerFailureModes(category: EquipmentCategory, modes: FailureMode[]): void {
    this.failureModes.set(category, modes);
  }

  /**
   * Calculate health score for equipment
   */
  calculateHealthScore(
    equipment: EquipmentProfile,
    sensorReadings: Map<string, SensorReading[]>,
    anomalies: Anomaly[]
  ): HealthScore {
    const components: HealthScore['components'] = [];
    let totalWeight = 0;
    let weightedSum = 0;

    // Calculate component scores based on sensor readings
    for (const sensor of equipment.sensors) {
      const readings = sensorReadings.get(sensor.id) || [];
      if (readings.length === 0) continue;

      const features = FeatureEngineering.extractFeatures(readings, sensor);
      const latestValue = readings[readings.length - 1].value;

      // Calculate component score (0-100)
      let score = 100;
      let status: 'good' | 'fair' | 'poor' | 'critical' = 'good';
      let trend: 'improving' | 'stable' | 'declining' = 'stable';

      // Check against thresholds
      if (sensor.criticalHigh !== undefined && latestValue > sensor.criticalHigh) {
        score = 10;
        status = 'critical';
      } else if (sensor.criticalLow !== undefined && latestValue < sensor.criticalLow) {
        score = 10;
        status = 'critical';
      } else if (sensor.warningHigh !== undefined && latestValue > sensor.warningHigh) {
        score = 50;
        status = 'poor';
      } else if (sensor.warningLow !== undefined && latestValue < sensor.warningLow) {
        score = 50;
        status = 'poor';
      } else {
        // Calculate based on how close to warning thresholds
        const range = (sensor.maxValue || 100) - (sensor.minValue || 0);
        const normalizedValue = (latestValue - (sensor.minValue || 0)) / range;
        
        if (normalizedValue > 0.7 && sensor.warningHigh !== undefined) {
          score = 70;
          status = 'fair';
        } else if (normalizedValue < 0.3 && sensor.warningLow !== undefined) {
          score = 70;
          status = 'fair';
        }
      }

      // Trend analysis
      if (features.slope > 0.01) {
        trend = sensor.type === 'vibration' || sensor.type === 'temperature' 
          ? 'declining' 
          : 'improving';
      } else if (features.slope < -0.01) {
        trend = sensor.type === 'vibration' || sensor.type === 'temperature'
          ? 'improving'
          : 'declining';
      }

      // Weight based on sensor criticality
      const weight = this.getSensorWeight(sensor.type, equipment.category);
      totalWeight += weight;
      weightedSum += score * weight;

      components.push({
        name: sensor.name,
        score,
        weight,
        status,
        trend,
      });
    }

    // Adjust for recent anomalies
    const recentAnomalies = anomalies.filter(a => 
      a.equipmentId === equipment.id && 
      Date.now() - a.timestamp.getTime() < 24 * 60 * 60 * 1000
    );
    
    let anomalyPenalty = 0;
    for (const anomaly of recentAnomalies) {
      switch (anomaly.severity) {
        case 'critical': anomalyPenalty += 20; break;
        case 'high': anomalyPenalty += 10; break;
        case 'medium': anomalyPenalty += 5; break;
        case 'low': anomalyPenalty += 2; break;
      }
    }

    // Adjust for maintenance history
    const daysSinceLastMaintenance = equipment.lastMaintenanceDate
      ? (Date.now() - equipment.lastMaintenanceDate.getTime()) / (1000 * 60 * 60 * 24)
      : 365;
    
    const maintenancePenalty = Math.min(10, daysSinceLastMaintenance / 30);

    // Calculate overall score
    const baseScore = totalWeight > 0 ? weightedSum / totalWeight : 50;
    const overallScore = Math.max(0, Math.min(100, baseScore - anomalyPenalty - maintenancePenalty));

    // Calculate failure probabilities (simplified)
    const failureProbability = this.calculateFailureProbability(
      overallScore,
      equipment.operatingHours,
      equipment.category
    );

    // Calculate RUL
    const remainingUsefulLife = this.estimateRUL(
      overallScore,
      components,
      equipment
    );

    // Generate recommendations
    const recommendedActions = this.generateRecommendations(
      equipment,
      components,
      anomalies,
      failureProbability
    );

    return {
      equipmentId: equipment.id,
      timestamp: new Date(),
      overallScore,
      components,
      failureProbability,
      remainingUsefulLife,
      recommendedActions,
    };
  }

  private getSensorWeight(type: SensorType, category: EquipmentCategory): number {
    // Weights based on sensor importance for each equipment type
    const weights: Record<EquipmentCategory, Record<SensorType, number>> = {
      chiller: {
        temperature: 3,
        pressure: 3,
        vibration: 4,
        current: 2,
        voltage: 1,
        power: 2,
        flow: 3,
        level: 2,
        speed: 2,
        position: 1,
        humidity: 1,
        differential_pressure: 2,
      },
      compressor: {
        temperature: 3,
        pressure: 4,
        vibration: 5,
        current: 3,
        voltage: 1,
        power: 2,
        flow: 2,
        level: 3,
        speed: 2,
        position: 1,
        humidity: 1,
        differential_pressure: 2,
      },
      ahu: {
        temperature: 3,
        pressure: 2,
        vibration: 3,
        current: 2,
        voltage: 1,
        power: 2,
        flow: 4,
        level: 1,
        speed: 2,
        position: 2,
        humidity: 2,
        differential_pressure: 3,
      },
      rtu: {
        temperature: 3,
        pressure: 2,
        vibration: 3,
        current: 2,
        voltage: 1,
        power: 2,
        flow: 3,
        level: 1,
        speed: 2,
        position: 2,
        humidity: 2,
        differential_pressure: 2,
      },
      pump: {
        temperature: 2,
        pressure: 4,
        vibration: 5,
        current: 3,
        voltage: 1,
        power: 2,
        flow: 4,
        level: 3,
        speed: 3,
        position: 1,
        humidity: 1,
        differential_pressure: 3,
      },
      fan: {
        temperature: 2,
        pressure: 2,
        vibration: 5,
        current: 3,
        voltage: 1,
        power: 2,
        flow: 4,
        level: 1,
        speed: 3,
        position: 1,
        humidity: 1,
        differential_pressure: 2,
      },
      vfd: {
        temperature: 4,
        pressure: 1,
        vibration: 1,
        current: 4,
        voltage: 3,
        power: 3,
        flow: 1,
        level: 1,
        speed: 2,
        position: 1,
        humidity: 1,
        differential_pressure: 1,
      },
      boiler: {
        temperature: 5,
        pressure: 4,
        vibration: 2,
        current: 2,
        voltage: 1,
        power: 2,
        flow: 3,
        level: 4,
        speed: 1,
        position: 2,
        humidity: 1,
        differential_pressure: 2,
      },
      cooling_tower: {
        temperature: 3,
        pressure: 2,
        vibration: 3,
        current: 2,
        voltage: 1,
        power: 2,
        flow: 4,
        level: 3,
        speed: 2,
        position: 1,
        humidity: 2,
        differential_pressure: 2,
      },
    };

    return weights[category]?.[type] ?? 1;
  }

  private calculateFailureProbability(
    healthScore: number,
    operatingHours: number,
    category: EquipmentCategory
  ): HealthScore['failureProbability'] {
    // Simplified Weibull-based failure probability
    // In a real implementation, use actual failure data
    const mtbf: Record<EquipmentCategory, number> = {
      chiller: 40000,
      compressor: 30000,
      ahu: 50000,
      rtu: 45000,
      pump: 60000,
      fan: 70000,
      vfd: 80000,
      boiler: 35000,
      cooling_tower: 50000,
    };

    const baseHours = mtbf[category] || 50000;
    const beta = 2.5; // Shape parameter
    const eta = baseHours; // Scale parameter

    // Weibull probability at current operating hours
    const baseProb = 1 - Math.exp(-Math.pow(operatingHours / eta, beta));

    // Adjust based on health score
    const healthFactor = Math.pow((100 - healthScore) / 100, 2);
    
    return {
      next24Hours: Math.min(0.99, baseProb * 0.001 + healthFactor * 0.1),
      next7Days: Math.min(0.99, baseProb * 0.007 + healthFactor * 0.3),
      next30Days: Math.min(0.99, baseProb * 0.03 + healthFactor * 0.5),
    };
  }

  private estimateRUL(
    healthScore: number,
    components: HealthScore['components'],
    equipment: EquipmentProfile
  ): HealthScore['remainingUsefulLife'] {
    // Simplified RUL estimation
    // In a real implementation, use ML models trained on failure data

    // Find the weakest component
    const weakestComponent = components.reduce((min, c) => 
      c.score < min.score ? c : min
    , components[0]);

    if (!weakestComponent) return undefined;

    // Base RUL based on health score
    const baseRUL = (healthScore / 100) * 365; // Max 1 year

    // Adjust for declining trends
    const decliningComponents = components.filter(c => c.trend === 'declining').length;
    const trendFactor = 1 - (decliningComponents / components.length) * 0.3;

    // Adjust for operating hours
    const hoursUsed = equipment.operatingHours;
    const expectedLife = 87600; // 10 years in hours
    const lifeRemaining = Math.max(0, 1 - hoursUsed / expectedLife);

    const estimate = Math.round(baseRUL * trendFactor * (0.5 + 0.5 * lifeRemaining));
    const confidence = healthScore > 80 ? 0.8 : healthScore > 60 ? 0.6 : 0.4;

    return {
      estimate,
      confidence,
      lowerBound: Math.round(estimate * 0.7),
      upperBound: Math.round(estimate * 1.3),
    };
  }

  private generateRecommendations(
    equipment: EquipmentProfile,
    components: HealthScore['components'],
    anomalies: Anomaly[],
    failureProbability: HealthScore['failureProbability']
  ): MaintenanceRecommendation[] {
    const recommendations: MaintenanceRecommendation[] = [];

    // Check critical components
    for (const component of components) {
      if (component.status === 'critical') {
        recommendations.push({
          id: `rec-${equipment.id}-${component.name}-${Date.now()}`,
          priority: 'critical',
          category: 'emergency',
          title: `Immediate attention required for ${component.name}`,
          description: `${component.name} is in critical condition. Inspect immediately to prevent failure.`,
          estimatedCost: 5000,
          potentialSavings: 50000,
          deferrable: false,
        });
      } else if (component.status === 'poor') {
        recommendations.push({
          id: `rec-${equipment.id}-${component.name}-${Date.now()}`,
          priority: 'high',
          category: 'corrective',
          title: `Schedule inspection for ${component.name}`,
          description: `${component.name} is showing degradation. Schedule maintenance within 1 week.`,
          estimatedTimeToFailure: 7,
          estimatedCost: 2000,
          potentialSavings: 20000,
          deferrable: true,
          maxDeferDays: 7,
        });
      } else if (component.trend === 'declining') {
        recommendations.push({
          id: `rec-${equipment.id}-${component.name}-${Date.now()}`,
          priority: 'medium',
          category: 'predictive',
          title: `Monitor ${component.name} trend`,
          description: `${component.name} is showing declining trend. Include in next scheduled maintenance.`,
          estimatedTimeToFailure: 30,
          estimatedCost: 500,
          potentialSavings: 5000,
          deferrable: true,
          maxDeferDays: 30,
        });
      }
    }

    // Check for high failure probability
    if (failureProbability.next7Days > 0.3) {
      recommendations.push({
        id: `rec-${equipment.id}-failure-${Date.now()}`,
        priority: 'critical',
        category: 'predictive',
        title: 'High failure probability detected',
        description: `${(failureProbability.next7Days * 100).toFixed(0)}% probability of failure within 7 days. Immediate inspection recommended.`,
        estimatedTimeToFailure: 7,
        estimatedCost: 3000,
        potentialSavings: 100000,
        deferrable: false,
      });
    }

    // Check for recurring anomalies
    const anomalyCounts = new Map<string, number>();
    for (const anomaly of anomalies) {
      const key = anomaly.sensorId || 'general';
      anomalyCounts.set(key, (anomalyCounts.get(key) || 0) + 1);
    }

    for (const [key, count] of anomalyCounts) {
      if (count >= 3) {
        recommendations.push({
          id: `rec-${equipment.id}-anomaly-${key}-${Date.now()}`,
          priority: 'medium',
          category: 'investigation',
          title: `Recurring anomalies on ${key}`,
          description: `${count} anomalies detected. Investigate root cause.`,
          estimatedCost: 1000,
          potentialSavings: 10000,
          deferrable: true,
          maxDeferDays: 14,
        });
      }
    }

    // Sort by priority
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return recommendations;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Predictive Maintenance Engine
// ─────────────────────────────────────────────────────────────────────────────

export interface PredictiveMaintenanceConfig {
  anomalyDetection: AnomalyDetectorConfig;
  healthScoreInterval: number; // minutes
  dataRetentionDays: number;
  alertThresholds: {
    healthScoreLow: number;
    healthScoreCritical: number;
    failureProbabilityHigh: number;
  };
}

export class PredictiveMaintenanceEngine extends EventEmitter {
  private config: PredictiveMaintenanceConfig;
  private equipment: Map<string, EquipmentProfile> = new Map();
  private sensorData: Map<string, SensorReading[]> = new Map();
  private anomalies: Map<string, Anomaly[]> = new Map();
  private healthScores: Map<string, HealthScore[]> = new Map();
  private anomalyDetector: AnomalyDetector;
  private healthCalculator: HealthScoreCalculator;
  private healthCheckInterval?: ReturnType<typeof setInterval>;

  constructor(config: PredictiveMaintenanceConfig) {
    super();
    this.config = config;
    this.anomalyDetector = new AnomalyDetector(config.anomalyDetection);
    this.healthCalculator = new HealthScoreCalculator();
  }

  /**
   * Register equipment for monitoring
   */
  registerEquipment(equipment: EquipmentProfile): void {
    this.equipment.set(equipment.id, equipment);
    this.sensorData.set(equipment.id, []);
    this.anomalies.set(equipment.id, []);
    this.healthScores.set(equipment.id, []);

    // Train anomaly detector with any historical data
    for (const sensor of equipment.sensors) {
      const sensorKey = `${equipment.id}-${sensor.id}`;
      this.sensorData.set(sensorKey, []);
    }

    this.emit('equipment-registered', equipment);
  }

  /**
   * Ingest sensor reading
   */
  ingestReading(reading: SensorReading): void {
    const sensorKey = `${reading.equipmentId}-${reading.sensorId}`;
    const readings = this.sensorData.get(sensorKey) || [];
    readings.push(reading);

    // Keep only recent data
    const cutoff = new Date(Date.now() - this.config.dataRetentionDays * 24 * 60 * 60 * 1000);
    const filtered = readings.filter(r => r.timestamp >= cutoff);
    this.sensorData.set(sensorKey, filtered);

    // Check for anomalies
    const detection = this.anomalyDetector.detect(sensorKey, reading.value);
    if (detection.isAnomaly) {
      const equipment = this.equipment.get(reading.equipmentId);
      const sensor = equipment?.sensors.find(s => s.id === reading.sensorId);
      
      const anomaly: Anomaly = {
        id: `anomaly-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        equipmentId: reading.equipmentId,
        sensorId: reading.sensorId,
        timestamp: reading.timestamp,
        type: 'point',
        severity: detection.score > 0.8 ? 'critical' : detection.score > 0.5 ? 'high' : detection.score > 0.3 ? 'medium' : 'low',
        score: detection.score,
        description: detection.reason || 'Anomalous reading detected',
        affectedMetrics: [sensor?.name || reading.sensorId],
        potentialCauses: this.identifyPotentialCauses(reading, sensor),
        recommendedActions: this.getRecommendedActions(reading, sensor),
        acknowledged: false,
      };

      const equipmentAnomalies = this.anomalies.get(reading.equipmentId) || [];
      equipmentAnomalies.push(anomaly);
      this.anomalies.set(reading.equipmentId, equipmentAnomalies);

      this.emit('anomaly-detected', anomaly);
    }

    this.emit('reading-ingested', reading);
  }

  /**
   * Train anomaly detector on historical data
   */
  trainAnomalyDetector(equipmentId: string, sensorId: string, historicalData: number[]): void {
    const sensorKey = `${equipmentId}-${sensorId}`;
    this.anomalyDetector.train(sensorKey, historicalData);
  }

  /**
   * Calculate health score for equipment
   */
  calculateHealth(equipmentId: string): HealthScore | null {
    const equipment = this.equipment.get(equipmentId);
    if (!equipment) return null;

    // Gather sensor readings
    const sensorReadings = new Map<string, SensorReading[]>();
    for (const sensor of equipment.sensors) {
      const sensorKey = `${equipmentId}-${sensor.id}`;
      const readings = this.sensorData.get(sensorKey) || [];
      // Get last hour of readings
      const recentReadings = readings.filter(r =>
        Date.now() - r.timestamp.getTime() < 60 * 60 * 1000
      );
      sensorReadings.set(sensor.id, recentReadings);
    }

    // Get anomalies
    const equipmentAnomalies = this.anomalies.get(equipmentId) || [];

    // Calculate health score
    const healthScore = this.healthCalculator.calculateHealthScore(
      equipment,
      sensorReadings,
      equipmentAnomalies
    );

    // Store health score
    const scores = this.healthScores.get(equipmentId) || [];
    scores.push(healthScore);
    // Keep last 24 hours
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const filtered = scores.filter(s => s.timestamp >= cutoff);
    this.healthScores.set(equipmentId, filtered);

    // Check thresholds and emit alerts
    if (healthScore.overallScore < this.config.alertThresholds.healthScoreCritical) {
      this.emit('critical-alert', {
        equipmentId,
        type: 'health_critical',
        healthScore,
        message: `Equipment ${equipment.name} health score is critical: ${healthScore.overallScore}%`,
      });
    } else if (healthScore.overallScore < this.config.alertThresholds.healthScoreLow) {
      this.emit('warning-alert', {
        equipmentId,
        type: 'health_low',
        healthScore,
        message: `Equipment ${equipment.name} health score is low: ${healthScore.overallScore}%`,
      });
    }

    if (healthScore.failureProbability.next7Days > this.config.alertThresholds.failureProbabilityHigh) {
      this.emit('critical-alert', {
        equipmentId,
        type: 'high_failure_probability',
        healthScore,
        message: `Equipment ${equipment.name} has high failure probability: ${(healthScore.failureProbability.next7Days * 100).toFixed(0)}%`,
      });
    }

    this.emit('health-calculated', healthScore);
    return healthScore;
  }

  /**
   * Start periodic health calculations
   */
  start(): void {
    if (this.healthCheckInterval) return;

    this.healthCheckInterval = setInterval(() => {
      for (const equipmentId of this.equipment.keys()) {
        this.calculateHealth(equipmentId);
      }
    }, this.config.healthScoreInterval * 60 * 1000);

    this.emit('started');
  }

  /**
   * Stop periodic health calculations
   */
  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    this.emit('stopped');
  }

  private identifyPotentialCauses(reading: SensorReading, sensor?: SensorConfig): string[] {
    const causes: string[] = [];
    
    if (!sensor) return ['Unknown sensor configuration'];

    switch (sensor.type) {
      case 'vibration':
        causes.push('Bearing wear', 'Imbalance', 'Misalignment', 'Loose components');
        break;
      case 'temperature':
        causes.push('Inadequate cooling', 'Overload', 'Refrigerant leak', 'Fouled heat exchanger');
        break;
      case 'pressure':
        causes.push('Blockage', 'Leak', 'Valve malfunction', 'Compressor issue');
        break;
      case 'current':
        causes.push('Motor degradation', 'Electrical fault', 'Overload', 'Power quality issue');
        break;
      case 'flow':
        causes.push('Blockage', 'Pump wear', 'Valve issue', 'Air in system');
        break;
      default:
        causes.push('Equipment degradation', 'Sensor malfunction');
    }

    return causes;
  }

  private getRecommendedActions(reading: SensorReading, sensor?: SensorConfig): string[] {
    const actions: string[] = [];
    
    if (!sensor) return ['Verify sensor configuration'];

    switch (sensor.type) {
      case 'vibration':
        actions.push('Inspect bearings', 'Check alignment', 'Tighten loose components', 'Balance rotating parts');
        break;
      case 'temperature':
        actions.push('Check refrigerant levels', 'Clean heat exchangers', 'Verify airflow', 'Check thermal insulation');
        break;
      case 'pressure':
        actions.push('Check for leaks', 'Inspect valves', 'Verify compressor operation', 'Clean filters');
        break;
      case 'current':
        actions.push('Check electrical connections', 'Inspect motor windings', 'Verify load conditions', 'Check power quality');
        break;
      default:
        actions.push('Schedule inspection', 'Review maintenance history');
    }

    return actions;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Getters
  // ─────────────────────────────────────────────────────────────────────────

  getEquipment(id: string): EquipmentProfile | undefined {
    return this.equipment.get(id);
  }

  getAllEquipment(): EquipmentProfile[] {
    return Array.from(this.equipment.values());
  }

  getAnomalies(equipmentId: string): Anomaly[] {
    return this.anomalies.get(equipmentId) || [];
  }

  getHealthHistory(equipmentId: string): HealthScore[] {
    return this.healthScores.get(equipmentId) || [];
  }

  getLatestHealthScore(equipmentId: string): HealthScore | undefined {
    const scores = this.healthScores.get(equipmentId) || [];
    return scores[scores.length - 1];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Function
// ─────────────────────────────────────────────────────────────────────────────

export function createPredictiveMaintenanceEngine(
  config?: Partial<PredictiveMaintenanceConfig>
): PredictiveMaintenanceEngine {
  const defaultConfig: PredictiveMaintenanceConfig = {
    anomalyDetection: {
      method: 'z_score',
      threshold: 3,
      windowSize: 100,
      minSamples: 30,
    },
    healthScoreInterval: 15, // minutes
    dataRetentionDays: 90,
    alertThresholds: {
      healthScoreLow: 60,
      healthScoreCritical: 30,
      failureProbabilityHigh: 0.3,
    },
  };

  return new PredictiveMaintenanceEngine({
    ...defaultConfig,
    ...config,
    anomalyDetection: {
      ...defaultConfig.anomalyDetection,
      ...config?.anomalyDetection,
    },
    alertThresholds: {
      ...defaultConfig.alertThresholds,
      ...config?.alertThresholds,
    },
  });
}
