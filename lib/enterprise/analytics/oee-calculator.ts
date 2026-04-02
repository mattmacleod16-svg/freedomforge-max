/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — OEE (Overall Equipment Effectiveness) Calculator
   Industry-standard OEE calculation based on SCADA/MES best practices
   References: DSI Innovations, Ignition SCADA, Sepasoft MES patterns
   ═══════════════════════════════════════════════════════════════════════════ */

import type {
  OEEMetrics,
  OEEBreakdown,
  OEETrend,
  OEEDataPoint,
  DowntimeEvent,
  QualityEvent,
  DateRange,
} from '../types/enterprise-types';

// ─────────────────────────────────────────────────────────────────────────────
// OEE Calculator Class
// ─────────────────────────────────────────────────────────────────────────────

export class OEECalculator {
  /**
   * Calculate OEE metrics from raw production data
   * OEE = Availability × Performance × Quality
   */
  static calculate(params: OEECalculationParams): OEEBreakdown {
    const {
      plannedTime,
      downtimeEvents,
      idealCycleTimeSeconds,
      totalProduced,
      goodUnits,
      qualityEvents,
      equipmentId,
      period,
    } = params;

    // Calculate downtime
    const totalDowntime = downtimeEvents.reduce(
      (sum, event) => sum + event.durationMinutes,
      0
    );
    const operatingTime = plannedTime - totalDowntime;

    // Calculate defects from quality events if goodUnits not directly provided
    const defectUnits = qualityEvents
      ? qualityEvents.reduce((sum, event) => sum + event.quantity, 0)
      : totalProduced - (goodUnits ?? totalProduced);

    const actualGoodUnits = goodUnits ?? totalProduced - defectUnits;

    // Availability = Operating Time / Planned Time
    const availability = plannedTime > 0 ? (operatingTime / plannedTime) * 100 : 0;

    // Performance = (Ideal Cycle Time × Total Count) / Operating Time
    // Convert operating time to seconds for comparison with cycle time
    const operatingTimeSeconds = operatingTime * 60;
    const theoreticalOutput =
      operatingTimeSeconds > 0 ? operatingTimeSeconds / idealCycleTimeSeconds : 0;
    const performance =
      theoreticalOutput > 0 ? (totalProduced / theoreticalOutput) * 100 : 0;

    // Quality = Good Units / Total Units
    const quality = totalProduced > 0 ? (actualGoodUnits / totalProduced) * 100 : 0;

    // OEE = Availability × Performance × Quality (as percentages, then /10000)
    const oee = (availability * performance * quality) / 10000;

    // Calculate actual cycle time
    const actualCycleTime =
      totalProduced > 0 ? operatingTimeSeconds / totalProduced : 0;

    return {
      metrics: {
        oee: this.round(oee),
        availability: this.round(availability),
        performance: this.round(Math.min(performance, 100)), // Cap at 100%
        quality: this.round(quality),
        calculatedAt: new Date(),
        period,
        equipmentId,
      },
      plannedTime,
      operatingTime,
      downtime: totalDowntime,
      idealCycleTime: idealCycleTimeSeconds,
      actualCycleTime: this.round(actualCycleTime),
      totalProduced,
      goodUnits: actualGoodUnits,
      defectUnits,
      downtimeEvents,
      qualityEvents: qualityEvents || [],
    };
  }

  /**
   * Calculate OEE trend over time
   */
  static calculateTrend(
    dataPoints: OEEDataPoint[],
    period: 'hourly' | 'daily' | 'weekly' | 'monthly'
  ): OEETrend {
    if (dataPoints.length === 0) {
      return {
        period,
        dataPoints: [],
        averageOEE: 0,
        bestOEE: 0,
        worstOEE: 0,
        trend: 'stable',
      };
    }

    const oeeValues = dataPoints.map((dp) => dp.oee);
    const averageOEE = oeeValues.reduce((a, b) => a + b, 0) / oeeValues.length;
    const bestOEE = Math.max(...oeeValues);
    const worstOEE = Math.min(...oeeValues);

    // Calculate trend using linear regression slope
    const trend = this.determineTrend(dataPoints);

    return {
      period,
      dataPoints,
      averageOEE: this.round(averageOEE),
      bestOEE: this.round(bestOEE),
      worstOEE: this.round(worstOEE),
      trend,
    };
  }

  /**
   * Aggregate OEE across multiple equipment/lines
   */
  static aggregateOEE(breakdowns: OEEBreakdown[]): OEEMetrics {
    if (breakdowns.length === 0) {
      return {
        oee: 0,
        availability: 0,
        performance: 0,
        quality: 0,
        calculatedAt: new Date(),
        period: { start: new Date(), end: new Date() },
        equipmentId: 'aggregate',
      };
    }

    // Weight by operating time for more accurate aggregation
    const totalOperatingTime = breakdowns.reduce((sum, b) => sum + b.operatingTime, 0);

    let weightedAvailability = 0;
    let weightedPerformance = 0;
    let weightedQuality = 0;

    for (const breakdown of breakdowns) {
      const weight =
        totalOperatingTime > 0 ? breakdown.operatingTime / totalOperatingTime : 1 / breakdowns.length;
      weightedAvailability += breakdown.metrics.availability * weight;
      weightedPerformance += breakdown.metrics.performance * weight;
      weightedQuality += breakdown.metrics.quality * weight;
    }

    const oee = (weightedAvailability * weightedPerformance * weightedQuality) / 10000;

    // Determine period range from all breakdowns
    const starts = breakdowns.map((b) => b.metrics.period.start.getTime());
    const ends = breakdowns.map((b) => b.metrics.period.end.getTime());

    return {
      oee: this.round(oee),
      availability: this.round(weightedAvailability),
      performance: this.round(weightedPerformance),
      quality: this.round(weightedQuality),
      calculatedAt: new Date(),
      period: {
        start: new Date(Math.min(...starts)),
        end: new Date(Math.max(...ends)),
      },
      equipmentId: 'aggregate',
    };
  }

  /**
   * Identify top loss categories from OEE breakdown
   */
  static analyzeLosses(breakdown: OEEBreakdown): OEELossAnalysis {
    const { downtimeEvents, plannedTime, idealCycleTime, operatingTime, totalProduced, defectUnits } =
      breakdown;

    // Categorize downtime losses
    const downtimeLosses = new Map<string, number>();
    for (const event of downtimeEvents) {
      const current = downtimeLosses.get(event.reasonCode) || 0;
      downtimeLosses.set(event.reasonCode, current + event.durationMinutes);
    }

    // Calculate speed loss (performance gap)
    const theoreticalProduction = (operatingTime * 60) / idealCycleTime;
    const speedLoss = theoreticalProduction - totalProduced;

    // Quality loss
    const qualityLoss = defectUnits;

    return {
      totalLossMinutes: plannedTime - operatingTime + (speedLoss * idealCycleTime) / 60,
      availabilityLosses: Array.from(downtimeLosses.entries()).map(([reason, minutes]) => ({
        reason,
        minutes,
        percentOfTotal: (minutes / plannedTime) * 100,
      })),
      performanceLoss: {
        unitsLost: Math.max(0, speedLoss),
        minutesEquivalent: (Math.max(0, speedLoss) * idealCycleTime) / 60,
      },
      qualityLoss: {
        unitsLost: qualityLoss,
        minutesEquivalent: (qualityLoss * idealCycleTime) / 60,
      },
    };
  }

  /**
   * Get OEE benchmarks for comparison
   */
  static getBenchmarks(): OEEBenchmarks {
    return {
      worldClass: { oee: 85, availability: 90, performance: 95, quality: 99.9 },
      good: { oee: 65, availability: 80, performance: 85, quality: 95 },
      average: { oee: 40, availability: 70, performance: 70, quality: 85 },
    };
  }

  /**
   * Score OEE against benchmarks
   */
  static scoreOEE(metrics: OEEMetrics): OEEScore {
    const benchmarks = this.getBenchmarks();

    let rating: 'world_class' | 'good' | 'average' | 'needs_improvement';
    if (metrics.oee >= benchmarks.worldClass.oee) {
      rating = 'world_class';
    } else if (metrics.oee >= benchmarks.good.oee) {
      rating = 'good';
    } else if (metrics.oee >= benchmarks.average.oee) {
      rating = 'average';
    } else {
      rating = 'needs_improvement';
    }

    // Identify which factor is the biggest limiter
    const factors = [
      { name: 'availability' as const, value: metrics.availability },
      { name: 'performance' as const, value: metrics.performance },
      { name: 'quality' as const, value: metrics.quality },
    ];
    factors.sort((a, b) => a.value - b.value);

    return {
      rating,
      score: metrics.oee,
      limitingFactor: factors[0].name,
      limitingFactorValue: factors[0].value,
      improvementPotential: benchmarks.worldClass.oee - metrics.oee,
      recommendations: this.generateRecommendations(metrics, factors[0].name),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private static round(value: number, decimals = 2): number {
    return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
  }

  private static determineTrend(
    dataPoints: OEEDataPoint[]
  ): 'improving' | 'declining' | 'stable' {
    if (dataPoints.length < 3) return 'stable';

    // Simple linear regression
    const n = dataPoints.length;
    let sumX = 0,
      sumY = 0,
      sumXY = 0,
      sumX2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += dataPoints[i].oee;
      sumXY += i * dataPoints[i].oee;
      sumX2 += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

    // Consider improvement/decline if slope magnitude > 0.5% per period
    if (slope > 0.5) return 'improving';
    if (slope < -0.5) return 'declining';
    return 'stable';
  }

  private static generateRecommendations(
    metrics: OEEMetrics,
    limitingFactor: 'availability' | 'performance' | 'quality'
  ): string[] {
    const recommendations: string[] = [];

    if (limitingFactor === 'availability' || metrics.availability < 90) {
      recommendations.push('Implement predictive maintenance to reduce unplanned downtime');
      recommendations.push('Optimize changeover procedures (SMED methodology)');
      recommendations.push('Review planned maintenance schedules for optimization');
    }

    if (limitingFactor === 'performance' || metrics.performance < 95) {
      recommendations.push('Identify and address minor stoppages and slow cycles');
      recommendations.push('Review and optimize machine speed settings');
      recommendations.push('Train operators on optimal running parameters');
    }

    if (limitingFactor === 'quality' || metrics.quality < 99) {
      recommendations.push('Implement statistical process control (SPC)');
      recommendations.push('Conduct root cause analysis on top defect types');
      recommendations.push('Review incoming material quality standards');
    }

    return recommendations;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Types for OEE Calculation
// ─────────────────────────────────────────────────────────────────────────────

export interface OEECalculationParams {
  /** Equipment/line identifier */
  equipmentId: string;
  /** Time period for calculation */
  period: DateRange;
  /** Planned production time in minutes */
  plannedTime: number;
  /** List of downtime events during the period */
  downtimeEvents: DowntimeEvent[];
  /** Ideal/standard cycle time per unit in seconds */
  idealCycleTimeSeconds: number;
  /** Total units produced (good + defects) */
  totalProduced: number;
  /** Good units produced (if known directly) */
  goodUnits?: number;
  /** Quality events (defects, rejects) */
  qualityEvents?: QualityEvent[];
}

export interface OEELossAnalysis {
  totalLossMinutes: number;
  availabilityLosses: {
    reason: string;
    minutes: number;
    percentOfTotal: number;
  }[];
  performanceLoss: {
    unitsLost: number;
    minutesEquivalent: number;
  };
  qualityLoss: {
    unitsLost: number;
    minutesEquivalent: number;
  };
}

export interface OEEBenchmarks {
  worldClass: { oee: number; availability: number; performance: number; quality: number };
  good: { oee: number; availability: number; performance: number; quality: number };
  average: { oee: number; availability: number; performance: number; quality: number };
}

export interface OEEScore {
  rating: 'world_class' | 'good' | 'average' | 'needs_improvement';
  score: number;
  limitingFactor: 'availability' | 'performance' | 'quality';
  limitingFactorValue: number;
  improvementPotential: number;
  recommendations: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Real-time OEE Tracker (for live dashboards)
// ─────────────────────────────────────────────────────────────────────────────

export class RealTimeOEETracker {
  private equipmentId: string;
  private shiftStart: Date;
  private plannedTimeMinutes: number;
  private idealCycleTimeSeconds: number;

  private downtimeEvents: DowntimeEvent[] = [];
  private qualityEvents: QualityEvent[] = [];
  private goodCount = 0;
  private rejectCount = 0;
  private currentDowntimeStart: Date | null = null;
  private currentDowntimeReason: DowntimeEvent['reasonCode'] | null = null;

  constructor(
    equipmentId: string,
    shiftStart: Date,
    plannedTimeMinutes: number,
    idealCycleTimeSeconds: number
  ) {
    this.equipmentId = equipmentId;
    this.shiftStart = shiftStart;
    this.plannedTimeMinutes = plannedTimeMinutes;
    this.idealCycleTimeSeconds = idealCycleTimeSeconds;
  }

  /**
   * Record a production count (from PLC/SCADA)
   */
  recordProduction(goodCount: number, rejectCount = 0): void {
    this.goodCount += goodCount;
    this.rejectCount += rejectCount;
  }

  /**
   * Start tracking a downtime event
   */
  startDowntime(reasonCode: DowntimeEvent['reasonCode'], _isPlanned = false): void {
    if (this.currentDowntimeStart) return; // Already in downtime
    this.currentDowntimeStart = new Date();
    this.currentDowntimeReason = reasonCode;
  }

  /**
   * End current downtime event
   */
  endDowntime(
    reasonCode?: DowntimeEvent['reasonCode'],
    isPlanned = false,
    notes?: string
  ): void {
    if (!this.currentDowntimeStart) return;

    const now = new Date();
    const durationMinutes =
      (now.getTime() - this.currentDowntimeStart.getTime()) / 60000;

    this.downtimeEvents.push({
      id: `dt-${Date.now()}`,
      equipmentId: this.equipmentId,
      startTime: this.currentDowntimeStart,
      endTime: now,
      durationMinutes,
      reasonCode: reasonCode || this.currentDowntimeReason || 'other',
      isPlanned,
      notes,
    });

    this.currentDowntimeStart = null;
    this.currentDowntimeReason = null;
  }

  /**
   * Record a quality event (defect/reject)
   */
  recordQualityEvent(defectCode: string, quantity: number): void {
    this.qualityEvents.push({
      id: `qe-${Date.now()}`,
      equipmentId: this.equipmentId,
      timestamp: new Date(),
      defectCode,
      quantity,
    });
  }

  /**
   * Get current OEE snapshot
   */
  getCurrentOEE(): OEEBreakdown {
    const now = new Date();
    const elapsedMinutes = Math.min(
      (now.getTime() - this.shiftStart.getTime()) / 60000,
      this.plannedTimeMinutes
    );

    // Include any ongoing downtime
    let activeDowntime = 0;
    if (this.currentDowntimeStart) {
      activeDowntime = (now.getTime() - this.currentDowntimeStart.getTime()) / 60000;
    }

    const allDowntime = [...this.downtimeEvents];
    if (activeDowntime > 0) {
      allDowntime.push({
        id: 'active',
        equipmentId: this.equipmentId,
        startTime: this.currentDowntimeStart!,
        durationMinutes: activeDowntime,
        reasonCode: this.currentDowntimeReason || 'other',
        isPlanned: false,
      });
    }

    return OEECalculator.calculate({
      equipmentId: this.equipmentId,
      period: { start: this.shiftStart, end: now },
      plannedTime: elapsedMinutes,
      downtimeEvents: allDowntime,
      idealCycleTimeSeconds: this.idealCycleTimeSeconds,
      totalProduced: this.goodCount + this.rejectCount,
      goodUnits: this.goodCount,
      qualityEvents: this.qualityEvents,
    });
  }

  /**
   * Reset tracker for new shift
   */
  reset(newShiftStart: Date): void {
    this.shiftStart = newShiftStart;
    this.downtimeEvents = [];
    this.qualityEvents = [];
    this.goodCount = 0;
    this.rejectCount = 0;
    this.currentDowntimeStart = null;
    this.currentDowntimeReason = null;
  }
}
