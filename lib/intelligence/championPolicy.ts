import fs from 'fs';
import path from 'path';

type Regime = 'risk_on' | 'risk_off' | 'neutral' | 'unknown';

interface ModelStats {
  uses: number;
  ewmaReward: number;
  ewmaRisk: number;
  ewmaCalibrationPenalty: number;
  updatedAt: number;
}

interface ChampionPolicyState {
  byRegime: Record<Regime, Record<string, ModelStats>>;
  updatedAt: number;
}

interface EnsembleModelStatInput {
  model: string;
  queried: number;
  participated: number;
  wins: number;
  participationRate: number;
  winRate: number;
}

interface EnsembleSignalInput {
  modelStats: EnsembleModelStatInput[];
  averageAgreement: number | null;
  highDisagreementRate: number | null;
}

interface RoutingInput {
  availableModels: string[];
  regime: Regime;
  forecastBrierScore: number;
  forecastConfidence: number;
  marketConfidence: number;
}

interface OutcomeInput {
  regime: Regime;
  queriedModels: string[];
  selectedModel: string;
  reward: number;
  riskScore: number;
  forecastBrierScore: number;
}

const DATA_DIR = process.env.VERCEL ? '/tmp/freedomforge-data' : path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'champion-policy.json');
const MIN_USES_FOR_CHAMPION = Math.max(3, Number(process.env.CHAMPION_MIN_USES || 6));

function isMaxModeEnabled() {
  return String(process.env.MAX_INTELLIGENCE_MODE || process.env.AUTONOMY_MAX_MODE || 'false').toLowerCase() === 'true';
}

let initialized = false;
let state: ChampionPolicyState = {
  byRegime: {
    risk_on: {},
    risk_off: {},
    neutral: {},
    unknown: {},
  },
  updatedAt: 0,
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function saveState() {
  try {
    ensureDataDir();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch {}
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function scoreModel(stats: ModelStats) {
  return (stats.ewmaReward * 0.62) + ((1 - stats.ewmaRisk) * 0.23) + ((1 - stats.ewmaCalibrationPenalty) * 0.15);
}

function defaultStats(): ModelStats {
  return {
    uses: 0,
    ewmaReward: 0.5,
    ewmaRisk: 0.5,
    ewmaCalibrationPenalty: 0.5,
    updatedAt: 0,
  };
}

function getStats(regime: Regime, modelName: string) {
  const normalizedName = modelName.toLowerCase();
  const bucket = state.byRegime[regime] || {};
  if (!bucket[normalizedName]) bucket[normalizedName] = defaultStats();
  state.byRegime[regime] = bucket;
  return bucket[normalizedName];
}

function ewma(previous: number, value: number, alpha = 0.18) {
  return previous + alpha * (value - previous);
}

export function initializeChampionPolicy() {
  if (initialized) return;
  initialized = true;

  try {
    ensureDataDir();
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<ChampionPolicyState>;
      state = {
        byRegime: {
          risk_on: parsed.byRegime?.risk_on || {},
          risk_off: parsed.byRegime?.risk_off || {},
          neutral: parsed.byRegime?.neutral || {},
          unknown: parsed.byRegime?.unknown || {},
        },
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      };
    } else {
      saveState();
    }
  } catch {
    saveState();
  }
}

export function selectChampionChallengerRouting(input: RoutingInput) {
  initializeChampionPolicy();
  const maxMode = isMaxModeEnabled();

  const regime = input.regime;
  const available = input.availableModels.map((name) => name.toLowerCase());
  const stats = available.map((name) => ({
    model: name,
    stats: getStats(regime, name),
  }));

  const enoughData = stats.some((item) => item.stats.uses >= MIN_USES_FOR_CHAMPION);

  const ranked = [...stats].sort((a, b) => {
    const aScore = scoreModel(a.stats);
    const bScore = scoreModel(b.stats);
    if (bScore !== aScore) return bScore - aScore;
    return b.stats.uses - a.stats.uses;
  });

  const preferredModels = enoughData
    ? ranked.map((item) => item.model)
    : available;

  let modelCount = 2;
  if (input.regime === 'risk_off') modelCount = 3;
  if (input.forecastBrierScore > 0.22) modelCount = Math.max(modelCount, 3);
  if (input.forecastConfidence < 0.5 || input.marketConfidence < 0.45) modelCount = Math.max(modelCount, 3);
  if (maxMode) {
    modelCount = Math.max(modelCount, Number(process.env.CHAMPION_MAX_MODEL_COUNT || 4));
    if (input.regime === 'risk_off' || input.forecastBrierScore > 0.2 || input.forecastConfidence < 0.52) {
      modelCount = Math.max(modelCount, 5);
    }
  }
  modelCount = Math.min(Math.max(1, modelCount), Math.max(1, available.length));

  return {
    modelCount,
    preferredModels,
    champion: preferredModels[0] || null,
    challenger: preferredModels[1] || null,
    rationale: enoughData
      ? `regime=${regime}, champion performance-ranked with calibration-aware scoring${maxMode ? '; max_mode=ensemble' : ''}`
      : `regime=${regime}, insufficient history so fallback to configured model priority${maxMode ? '; max_mode=ensemble' : ''}`,
  };
}

export function recordChampionOutcome(input: OutcomeInput) {
  initializeChampionPolicy();

  const selectedModel = input.selectedModel.toLowerCase();
  const queried = Array.from(new Set(input.queriedModels.map((item) => item.toLowerCase())));
  const calibrationPenalty = clamp(input.forecastBrierScore, 0, 1);

  queried.forEach((modelName) => {
    const stats = getStats(input.regime, modelName);
    const isSelected = modelName === selectedModel;
    const reward = isSelected ? clamp(input.reward) : clamp(input.reward * 0.45);
    const risk = isSelected ? clamp(input.riskScore) : clamp(Math.min(1, input.riskScore + 0.12));

    stats.uses += 1;
    stats.ewmaReward = ewma(stats.ewmaReward, reward);
    stats.ewmaRisk = ewma(stats.ewmaRisk, risk);
    stats.ewmaCalibrationPenalty = ewma(stats.ewmaCalibrationPenalty, calibrationPenalty);
    stats.updatedAt = Date.now();
  });

  state.updatedAt = Date.now();
  saveState();
}

export function autoTuneApprovalThresholds(input: {
  mode: 'assisted' | 'balanced' | 'autonomous';
  autoApproveMinConfidence: number;
  maxRiskForAutoApprove: number;
  alwaysEscalateOnEthicsFlags: boolean;
  currentErrorRate: number;
  forecastBrierScore: number;
  marketRegime: Regime;
}) {
  initializeChampionPolicy();

  let nextAutoConfidence = input.autoApproveMinConfidence;
  let nextMaxRisk = input.maxRiskForAutoApprove;

  const highCalibrationDrift = input.forecastBrierScore > 0.24;
  const lowCalibrationError = input.forecastBrierScore < 0.16;
  const highErrorRate = input.currentErrorRate > 0.12;
  const lowErrorRate = input.currentErrorRate < 0.05;

  if (input.marketRegime === 'risk_off' || highCalibrationDrift || highErrorRate) {
    nextAutoConfidence = clamp(nextAutoConfidence + 0.03, 0.55, 0.9);
    nextMaxRisk = clamp(nextMaxRisk - 0.04, 0.15, 0.7);
  } else if (input.marketRegime === 'risk_on' && lowCalibrationError && lowErrorRate) {
    nextAutoConfidence = clamp(nextAutoConfidence - 0.015, 0.55, 0.9);
    nextMaxRisk = clamp(nextMaxRisk + 0.02, 0.15, 0.7);
  }

  return {
    mode: input.mode,
    autoApproveMinConfidence: Number(nextAutoConfidence.toFixed(4)),
    maxRiskForAutoApprove: Number(nextMaxRisk.toFixed(4)),
    alwaysEscalateOnEthicsFlags: input.alwaysEscalateOnEthicsFlags,
    tuned: nextAutoConfidence !== input.autoApproveMinConfidence || nextMaxRisk !== input.maxRiskForAutoApprove,
  };
}

export function getChampionPolicySnapshot() {
  initializeChampionPolicy();

  const summarizeRegime = (regime: Regime) => {
    const entries = Object.entries(state.byRegime[regime] || {}).map(([model, stats]) => ({
      model,
      uses: stats.uses,
      ewmaReward: Number(stats.ewmaReward.toFixed(4)),
      ewmaRisk: Number(stats.ewmaRisk.toFixed(4)),
      ewmaCalibrationPenalty: Number(stats.ewmaCalibrationPenalty.toFixed(4)),
      score: Number(scoreModel(stats).toFixed(4)),
    }));

    entries.sort((a, b) => b.score - a.score || b.uses - a.uses);
    return {
      champion: entries[0] || null,
      challenger: entries[1] || null,
      models: entries,
    };
  };

  return {
    updatedAt: state.updatedAt,
    byRegime: {
      risk_on: summarizeRegime('risk_on'),
      risk_off: summarizeRegime('risk_off'),
      neutral: summarizeRegime('neutral'),
      unknown: summarizeRegime('unknown'),
    },
    minUsesForChampion: MIN_USES_FOR_CHAMPION,
  };
}

export function applyEnsembleSignals(input: {
  regime: Regime;
  signals: EnsembleSignalInput;
}) {
  initializeChampionPolicy();

  const agreement = typeof input.signals.averageAgreement === 'number' ? input.signals.averageAgreement : 0.5;
  const disagreement = typeof input.signals.highDisagreementRate === 'number' ? input.signals.highDisagreementRate : 0;

  const updates: Array<{ model: string; score: number; risk: number }> = [];

  input.signals.modelStats.forEach((item) => {
    const model = item.model.toLowerCase();
    const stats = getStats(input.regime, model);

    const sampleWeight = clamp(item.queried / 20, 0.12, 1);
    const winScore = clamp(item.winRate);
    const participationScore = clamp(item.participationRate);
    const disagreementPenalty = clamp(disagreement * (1 - participationScore));

    const blendedReward = clamp(
      winScore * 0.62 +
      participationScore * 0.2 +
      agreement * 0.18 -
      disagreementPenalty * 0.12
    );

    const blendedRisk = clamp(
      (1 - winScore) * 0.52 +
      disagreementPenalty * 0.28 +
      (1 - participationScore) * 0.2
    );

    const alpha = 0.08 * sampleWeight;
    stats.ewmaReward = ewma(stats.ewmaReward, blendedReward, alpha);
    stats.ewmaRisk = ewma(stats.ewmaRisk, blendedRisk, alpha);
    stats.ewmaCalibrationPenalty = ewma(stats.ewmaCalibrationPenalty, clamp(1 - agreement), alpha);
    stats.updatedAt = Date.now();

    updates.push({
      model,
      score: Number(scoreModel(stats).toFixed(4)),
      risk: Number(stats.ewmaRisk.toFixed(4)),
    });
  });

  state.updatedAt = Date.now();
  saveState();

  return {
    regime: input.regime,
    appliedModels: updates.length,
    averageAgreement: agreement,
    highDisagreementRate: disagreement,
    topAfterTuning: updates
      .sort((a, b) => b.score - a.score)
      .slice(0, 5),
  };
}
