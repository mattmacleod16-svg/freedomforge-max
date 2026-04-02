/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — Predictive Maintenance Module
   
   Machine learning-powered predictive maintenance for industrial equipment
   ═══════════════════════════════════════════════════════════════════════════ */

export {
  // Engine
  PredictiveMaintenanceEngine,
  createPredictiveMaintenanceEngine,
  
  // Feature Engineering
  FeatureEngineering,
  
  // Anomaly Detection
  AnomalyDetector,
  
  // Health Score
  HealthScoreCalculator,
} from './ml-engine';

export type {
  // Equipment types
  EquipmentCategory,
  EquipmentProfile,
  SensorConfig,
  SensorType,
  SensorReading,
  MaintenanceRecord,
  
  // Health & Analysis types
  HealthScore,
  MaintenanceRecommendation,
  Anomaly,
  FailureMode,
  EngineeredFeatures,
  
  // Configuration
  AnomalyDetectorConfig,
  PredictiveMaintenanceConfig,
} from './ml-engine';
