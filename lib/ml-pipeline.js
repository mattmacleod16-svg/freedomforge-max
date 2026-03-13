/**
 * ML Pipeline — Pure-JS gradient-boosted decision stump model for trade signal scoring.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * No Python, no TensorFlow, no external ML libraries. Everything is hand-rolled:
 *   - FeatureStore           — persistent sample buffer (FIFO, capped at 5000)
 *   - GradientBoostedModel   — mini GBM with decision stumps (real gradient boosting)
 *   - Feature extraction     — pulls indicator values from edge-detector signals
 *   - Train / Predict / Record / Boost — full lifecycle for online learning
 *
 * Uses resilient-io for crash-safe file I/O when available, raw fs as fallback.
 *
 * Usage:
 *   const ml = require('./ml-pipeline');
 *   const boost = ml.getMLSignalBoost(signal, signal.components);
 *   // boost = { adjustedConfidence, mlPrediction, shouldTrade }
 */

const fs = require('fs');
const path = require('path');

// ─── Resilient I/O (optional) ────────────────────────────────────────────────

let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

const { createLogger } = require('./logger');
const log = createLogger('ml-pipeline');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const FEATURE_STORE_PATH = path.join(DATA_DIR, 'ml-feature-store.json');
const MODEL_PATH = path.join(DATA_DIR, 'ml-model.json');

const MAX_SAMPLES = 5000;
const MIN_TRAIN_SAMPLES = 50;
const RETRAIN_INTERVAL = 50;

// ─── I/O Helpers ─────────────────────────────────────────────────────────────

/**
 * Read JSON with resilient-io if available, raw fs otherwise.
 * @param {string} filePath
 * @param {*} fallback — value to return on failure
 * @returns {*}
 */
function readJson(filePath, fallback) {
  if (rio) {
    return rio.readJsonSafe(filePath, { fallback });
  }
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    log.error(`Failed to read ${path.basename(filePath)}`, { error: err.message });
  }
  return fallback;
}

/**
 * Write JSON atomically with resilient-io if available, tmp+rename otherwise.
 * @param {string} filePath
 * @param {*} data
 */
function writeJson(filePath, data) {
  if (rio) {
    rio.writeJsonAtomic(filePath, data);
    return;
  }
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = filePath + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  } catch (err) {
    log.error(`Failed to write ${path.basename(filePath)}`, { error: err.message });
  }
}

// ─── Math Utilities ──────────────────────────────────────────────────────────

/**
 * Sigmoid function with clamping to prevent overflow.
 * @param {number} x
 * @returns {number} value in (0, 1)
 */
function sigmoid(x) {
  if (x > 500) return 1;
  if (x < -500) return 0;
  return 1 / (1 + Math.exp(-x));
}

/**
 * Compute approximately numQuantiles evenly-spaced thresholds from sorted unique values.
 * Used to generate candidate split points for decision stumps.
 * @param {number[]} values — raw feature values
 * @param {number} numQuantiles — desired number of thresholds (~10)
 * @returns {number[]} de-duplicated threshold values
 */
function quantileThresholds(values, numQuantiles) {
  const sorted = [...values].sort((a, b) => a - b);
  const unique = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0 || sorted[i] !== sorted[i - 1]) {
      unique.push(sorted[i]);
    }
  }
  if (unique.length <= 1) return unique;

  const thresholds = [];
  for (let q = 1; q <= numQuantiles; q++) {
    const idx = Math.min(
      Math.floor((q / (numQuantiles + 1)) * unique.length),
      unique.length - 1
    );
    if (thresholds.length === 0 || unique[idx] !== thresholds[thresholds.length - 1]) {
      thresholds.push(unique[idx]);
    }
  }
  return thresholds;
}

// ─── FeatureStore ────────────────────────────────────────────────────────────
// Persistent labeled-sample buffer for training. Samples are stored as:
//   { features: {name: value, ...}, label: 0|1, ts: epochMs }
// FIFO eviction once MAX_SAMPLES is reached.

class FeatureStore {
  /**
   * @param {string} [storePath] — override default path (useful for testing)
   */
  constructor(storePath) {
    this._path = storePath || FEATURE_STORE_PATH;
    const loaded = readJson(this._path, { samples: [] });
    this.samples = Array.isArray(loaded.samples) ? loaded.samples : [];
    this._lastTrainSize = loaded._lastTrainSize || 0;
  }

  /**
   * Add a labeled sample. Auto-saves to disk. FIFO eviction at 5000 samples.
   * @param {object} features — feature name/value pairs
   * @param {number} label — 1 = win, 0 = loss
   */
  addSample(features, label) {
    this.samples.push({
      features,
      label: label ? 1 : 0,
      ts: Date.now(),
    });
    while (this.samples.length > MAX_SAMPLES) {
      this.samples.shift();
    }
    this._save();
  }

  /**
   * Retrieve samples, optionally filtered by asset, time range.
   * @param {object} [opts]
   * @param {string} [opts.asset] — filter by features.asset
   * @param {number} [opts.minTs] — minimum timestamp (inclusive)
   * @param {number} [opts.maxTs] — maximum timestamp (inclusive)
   * @returns {Array<{features: object, label: number}>}
   */
  getSamples(opts) {
    let result = this.samples;
    if (opts) {
      if (opts.asset) {
        result = result.filter(s => s.features && s.features.asset === opts.asset);
      }
      if (opts.minTs != null) {
        result = result.filter(s => s.ts >= opts.minTs);
      }
      if (opts.maxTs != null) {
        result = result.filter(s => s.ts <= opts.maxTs);
      }
    }
    return result.map(s => ({ features: s.features, label: s.label }));
  }

  /**
   * @returns {number} current sample count
   */
  size() {
    return this.samples.length;
  }

  /**
   * Whether enough new samples have arrived since last training to trigger retrain.
   * @returns {boolean}
   */
  shouldRetrain() {
    return (this.samples.length - this._lastTrainSize) >= RETRAIN_INTERVAL;
  }

  /**
   * Mark current size as the last-trained checkpoint.
   */
  markTrained() {
    this._lastTrainSize = this.samples.length;
    this._save();
  }

  /** @private */
  _save() {
    writeJson(this._path, {
      samples: this.samples,
      _lastTrainSize: this._lastTrainSize,
    });
  }
}

// ─── GradientBoostedModel ────────────────────────────────────────────────────
//
// Real gradient boosting for binary classification (logistic loss).
//
// Each boosting round fits a decision stump (depth-1 tree) to the pseudo-
// residuals y_i - sigmoid(F(x_i)), where F is the current ensemble prediction
// in log-odds space.
//
// For each candidate stump we try ~10 quantile-based thresholds per feature,
// pick the split that minimizes the sum of squared residuals after fitting
// the stump, then update F(x_i) += learningRate * stumpPrediction(x_i).
//
// Leaf values are pre-scaled by learningRate during training so that predict()
// is a simple summation followed by sigmoid.

class GradientBoostedModel {
  constructor() {
    /** @type {Array<{featureIdx: number, threshold: number, leftVal: number, rightVal: number}>} */
    this.stumps = [];
    /** @type {string[]} */
    this.featureNames = [];
  }

  /**
   * Train the gradient boosted model on labeled data.
   *
   * @param {number[][]} X — N x D matrix of feature vectors
   * @param {number[]} y — N-length array of labels (0 or 1)
   * @param {object} [opts]
   * @param {number} [opts.numStumps=50] — number of boosting rounds
   * @param {number} [opts.learningRate=0.1] — shrinkage factor per round
   * @param {string[]} [opts.featureNames] — human-readable names for each feature index
   */
  train(X, y, opts) {
    const numStumps = (opts && opts.numStumps) || 50;
    const learningRate = (opts && opts.learningRate) || 0.1;
    this.featureNames = (opts && opts.featureNames) || [];
    this.stumps = [];

    const n = X.length;
    if (n === 0) return;
    const numFeatures = X[0].length;

    // F(x_i) in log-odds space, initialized to 0 (prior probability = 0.5)
    const predictions = new Float64Array(n);

    for (let round = 0; round < numStumps; round++) {
      // Pseudo-residuals for logistic loss: r_i = y_i - sigmoid(F(x_i))
      const residuals = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        residuals[i] = y[i] - sigmoid(predictions[i]);
      }

      // Search for the best decision stump across all features and thresholds
      let bestFeatureIdx = -1;
      let bestThreshold = 0;
      let bestLeftVal = 0;
      let bestRightVal = 0;
      let bestLoss = Infinity;

      for (let fIdx = 0; fIdx < numFeatures; fIdx++) {
        // Extract this feature column for quantile computation
        const col = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          col[i] = X[i][fIdx];
        }

        // Generate ~10 candidate split thresholds from quantiles
        const thresholds = quantileThresholds(Array.from(col), 10);

        for (let t = 0; t < thresholds.length; t++) {
          const threshold = thresholds[t];

          // Compute mean residual for left (<=threshold) and right (>threshold) partitions
          let leftSum = 0, leftCount = 0;
          let rightSum = 0, rightCount = 0;

          for (let i = 0; i < n; i++) {
            if (X[i][fIdx] <= threshold) {
              leftSum += residuals[i];
              leftCount++;
            } else {
              rightSum += residuals[i];
              rightCount++;
            }
          }

          // Skip degenerate splits (all samples on one side)
          if (leftCount === 0 || rightCount === 0) continue;

          const leftVal = leftSum / leftCount;
          const rightVal = rightSum / rightCount;

          // Evaluate: sum of squared residuals after subtracting stump predictions
          let loss = 0;
          for (let i = 0; i < n; i++) {
            const stumpPred = X[i][fIdx] <= threshold ? leftVal : rightVal;
            const diff = residuals[i] - stumpPred;
            loss += diff * diff;
          }

          if (loss < bestLoss) {
            bestLoss = loss;
            bestFeatureIdx = fIdx;
            bestThreshold = threshold;
            bestLeftVal = leftVal;
            bestRightVal = rightVal;
          }
        }
      }

      // If no valid split was found (e.g., all features are constant), stop early
      if (bestFeatureIdx < 0) break;

      // Pre-scale leaf values by learningRate so predict() is just a sum + sigmoid.
      // During training we use the same scaled values for the accumulator so that
      // the residuals at the next round are computed correctly relative to what
      // the final model will produce at inference time.
      const scaledLeftVal = learningRate * bestLeftVal;
      const scaledRightVal = learningRate * bestRightVal;

      this.stumps.push({
        featureIdx: bestFeatureIdx,
        threshold: bestThreshold,
        leftVal: scaledLeftVal,
        rightVal: scaledRightVal,
      });

      // Update ensemble predictions: F(x_i) += lr * stump(x_i)
      for (let i = 0; i < n; i++) {
        predictions[i] += X[i][bestFeatureIdx] <= bestThreshold
          ? scaledLeftVal
          : scaledRightVal;
      }
    }
  }

  /**
   * Predict win probability for a single feature vector.
   * Sums the (pre-scaled) leaf values of all stumps, applies sigmoid.
   *
   * @param {number[]} features — D-length array of feature values
   * @returns {number} probability in [0, 1]
   */
  predict(features) {
    let score = 0;
    for (let s = 0; s < this.stumps.length; s++) {
      const stump = this.stumps[s];
      score += features[stump.featureIdx] <= stump.threshold
        ? stump.leftVal
        : stump.rightVal;
    }
    return sigmoid(score);
  }

  /**
   * Batch prediction.
   * @param {number[][]} X — N x D matrix of feature vectors
   * @returns {number[]} array of probabilities
   */
  predictBatch(X) {
    const results = new Array(X.length);
    for (let i = 0; i < X.length; i++) {
      results[i] = this.predict(X[i]);
    }
    return results;
  }

  /**
   * Serialize the model to a JSON-safe object for persistence.
   * @returns {{ stumps: Array<{featureIdx, threshold, leftVal, rightVal}>, featureNames: string[] }}
   */
  serialize() {
    return {
      stumps: this.stumps.map(s => ({
        featureIdx: s.featureIdx,
        threshold: s.threshold,
        leftVal: s.leftVal,
        rightVal: s.rightVal,
      })),
      featureNames: this.featureNames.slice(),
    };
  }

  /**
   * Reconstruct a trained model from a serialized JSON object.
   * @param {object} json — output of serialize()
   * @returns {GradientBoostedModel}
   */
  static deserialize(json) {
    const model = new GradientBoostedModel();
    model.stumps = (json.stumps || []).map(s => ({
      featureIdx: s.featureIdx,
      threshold: s.threshold,
      leftVal: s.leftVal,
      rightVal: s.rightVal,
    }));
    model.featureNames = json.featureNames || [];
    return model;
  }

  /**
   * Feature importance: count how many times each feature was chosen as the split variable.
   * @returns {object} { featureName: selectionCount, ... }
   */
  getFeatureImportance() {
    const counts = {};
    for (let s = 0; s < this.stumps.length; s++) {
      const idx = this.stumps[s].featureIdx;
      const name = this.featureNames[idx] || ('feature_' + idx);
      counts[name] = (counts[name] || 0) + 1;
    }
    return counts;
  }
}

// ─── Feature Extraction ──────────────────────────────────────────────────────

/**
 * Canonical feature names in the order they appear in the feature vector.
 * Must stay in sync with the values array returned by extractFeatures().
 */
const FEATURE_NAMES = [
  'ema_cross',    // EMA crossover strength from multi-TF momentum [-1, 1]
  'rsi',          // RSI(14) normalized to [0, 1]
  'bb_pctb',      // Bollinger Band %B
  'bb_width',     // Bollinger Band width (bandwidth)
  'atr_pct',      // ATR as percentage of price
  'vol_ratio',    // Volume ratio (current / average)
  'composite',    // Edge detector composite score [-1, 1]
  'confidence',   // Edge detector confidence [0.5, 0.95]
  'hour',         // UTC hour of day normalized to [0, 1]
  'dow',          // UTC day of week normalized to [0, 1]
];

/**
 * Extract a numeric feature vector from edge-detector output.
 *
 * Pulls indicator values from the signal and its component objects.
 * Every field is guarded with safe defaults (0) so missing data never crashes.
 *
 * @param {object} signal — from edge-detector: { side, confidence, edge, compositeScore }
 * @param {object} components — from edge-detector: { multiTfMomentum, rsi, bollingerBands, atr, volumeConfirmation, dynamicThresholdBps, ... }
 * @returns {{ names: string[], values: number[] }}
 */
function extractFeatures(signal, components) {
  const comp = components || {};
  const sig = signal || {};
  const mtf = comp.multiTfMomentum || {};
  const bb = comp.bollingerBands || {};
  const vol = comp.volumeConfirmation || {};

  // 1. EMA crossover: direction * confluence * strength, mapped to [-1, 1]
  let emaCross = 0;
  if (mtf.direction === 'buy') {
    emaCross = (mtf.confluence || 0) * (0.5 + 0.5 * (mtf.avgStrength || 0));
  } else if (mtf.direction === 'sell') {
    emaCross = -(mtf.confluence || 0) * (0.5 + 0.5 * (mtf.avgStrength || 0));
  }

  // 2. RSI normalized to [0, 1] (raw value is 0-100)
  const rsiRaw = comp.rsi != null ? comp.rsi : 50;
  const rsi = rsiRaw / 100;

  // 3. Bollinger Band %B (typically 0-1, can exceed)
  const bbPctB = bb.percentB != null ? bb.percentB : 0.5;

  // 4. Bollinger Band width (bandwidth)
  const bbWidth = bb.width != null ? bb.width : 0;

  // 5. ATR as percentage of price (dynamicThresholdBps is ATR-derived, in basis points)
  const dynBps = comp.dynamicThresholdBps || 0;
  const atrPct = dynBps > 0 ? dynBps / 100 : 0;

  // 6. Volume ratio (current volume vs moving-average volume)
  const volRatio = vol.ratio != null ? vol.ratio : 1;

  // 7. Composite score from edge detector
  const compositeScore = sig.compositeScore != null ? sig.compositeScore : 0;

  // 8. Confidence from edge detector
  const confidence = sig.confidence != null ? sig.confidence : 0.5;

  // 9-10. Time features (UTC, normalized)
  const now = new Date();
  const hourOfDay = now.getUTCHours() / 24;
  const dayOfWeek = now.getUTCDay() / 6;

  return {
    names: FEATURE_NAMES,
    values: [
      emaCross,
      rsi,
      bbPctB,
      bbWidth,
      atrPct,
      volRatio,
      compositeScore,
      confidence,
      hourOfDay,
      dayOfWeek,
    ],
  };
}

// ─── trainModel ──────────────────────────────────────────────────────────────

/**
 * Train (or retrain) the ML model from all samples in the FeatureStore.
 *
 * Requires >= 50 samples. Splits 80/20 train/validation. Only persists the
 * model to disk if validation accuracy exceeds 55%.
 *
 * @param {object} [opts]
 * @param {number} [opts.numStumps=50]
 * @param {number} [opts.learningRate=0.1]
 * @param {string} [opts.storePath] — override feature store path
 * @param {string} [opts.modelPath] — override model output path
 * @returns {{ trained: boolean, trainAccuracy: number, valAccuracy: number, samples: number, featureImportance: object } | null}
 */
function trainModel(opts) {
  const options = opts || {};
  const store = new FeatureStore(options.storePath);
  const samples = store.getSamples();

  if (samples.length < MIN_TRAIN_SAMPLES) {
    log.info('Not enough samples to train', { current: samples.length, required: MIN_TRAIN_SAMPLES });
    return null;
  }

  // Convert feature objects -> numeric arrays aligned to FEATURE_NAMES
  const X = [];
  const y = [];
  for (let i = 0; i < samples.length; i++) {
    const fObj = samples[i].features || {};
    const row = new Array(FEATURE_NAMES.length);
    for (let f = 0; f < FEATURE_NAMES.length; f++) {
      const val = fObj[FEATURE_NAMES[f]];
      row[f] = (val != null && Number.isFinite(val)) ? val : 0;
    }
    X.push(row);
    y.push(samples[i].label);
  }

  // Deterministic shuffle (Fisher-Yates with xorshift PRNG seeded on sample count)
  const indices = [];
  for (let i = 0; i < X.length; i++) indices.push(i);

  let seed = (X.length * 2654435761) & 0x7fffffff;
  if (seed === 0) seed = 1;
  function xorshift() {
    seed ^= (seed << 13) & 0x7fffffff;
    seed ^= (seed >> 17);
    seed ^= (seed << 5) & 0x7fffffff;
    seed = seed & 0x7fffffff;
    return seed / 0x7fffffff;
  }

  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(xorshift() * (i + 1));
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
  }

  const shuffledX = indices.map(function (idx) { return X[idx]; });
  const shuffledY = indices.map(function (idx) { return y[idx]; });

  // 80/20 train/validation split
  const splitIdx = Math.floor(shuffledX.length * 0.8);
  const trainX = shuffledX.slice(0, splitIdx);
  const trainY = shuffledY.slice(0, splitIdx);
  const valX = shuffledX.slice(splitIdx);
  const valY = shuffledY.slice(splitIdx);

  if (trainX.length === 0 || valX.length === 0) {
    log.info('Insufficient data after split');
    return null;
  }

  // Train GBM
  const model = new GradientBoostedModel();
  model.train(trainX, trainY, {
    numStumps: options.numStumps || 50,
    learningRate: options.learningRate || 0.1,
    featureNames: FEATURE_NAMES,
  });

  // Training accuracy
  const trainPreds = model.predictBatch(trainX);
  let trainCorrect = 0;
  for (let i = 0; i < trainX.length; i++) {
    if ((trainPreds[i] >= 0.5 ? 1 : 0) === trainY[i]) trainCorrect++;
  }
  const trainAccuracy = (trainCorrect / trainX.length) * 100;

  // Validation accuracy
  const valPreds = model.predictBatch(valX);
  let valCorrect = 0;
  for (let i = 0; i < valX.length; i++) {
    if ((valPreds[i] >= 0.5 ? 1 : 0) === valY[i]) valCorrect++;
  }
  const valAccuracy = valX.length > 0 ? (valCorrect / valX.length) * 100 : 0;

  const featureImportance = model.getFeatureImportance();

  const result = {
    trained: valAccuracy > 60,
    trainAccuracy: Math.round(trainAccuracy * 100) / 100,
    valAccuracy: Math.round(valAccuracy * 100) / 100,
    samples: samples.length,
    featureImportance,
  };

  // Persist only if validation accuracy beats 60%
  if (valAccuracy > 60) {
    const serialized = model.serialize();
    serialized.trainedAt = new Date().toISOString();
    serialized.trainAccuracy = result.trainAccuracy;
    serialized.valAccuracy = result.valAccuracy;
    serialized.sampleCount = samples.length;
    writeJson(options.modelPath || MODEL_PATH, serialized);
    store.markTrained();
    log.info('Model saved', { valAccuracy: result.valAccuracy, samples: samples.length });
  } else {
    log.warn('Model not saved — val accuracy below threshold', { valAccuracy: result.valAccuracy, threshold: 55 });
  }

  return result;
}

// ─── predict ─────────────────────────────────────────────────────────────────

/**
 * Load a persisted model and predict win probability for a feature vector.
 *
 * If no model is on disk, returns a neutral prediction that does not block trading.
 *
 * @param {number[]} features — D-length array of feature values (same order as FEATURE_NAMES)
 * @param {object} [opts]
 * @param {string} [opts.modelPath] — override model file path
 * @returns {{ winProbability: number, confidence: number, shouldTrade: boolean }}
 */
function predict(features, opts) {
  const options = opts || {};
  const modelData = readJson(options.modelPath || MODEL_PATH, null);

  if (!modelData || !modelData.stumps || modelData.stumps.length === 0) {
    return {
      winProbability: 0.5,
      confidence: 0,
      shouldTrade: true,
    };
  }

  const model = GradientBoostedModel.deserialize(modelData);
  const winProbability = model.predict(features);
  const confidence = Math.abs(winProbability - 0.5) * 2;
  const shouldTrade = winProbability > 0.55;

  return {
    winProbability,
    confidence,
    shouldTrade,
  };
}

// ─── recordOutcome ───────────────────────────────────────────────────────────

/**
 * Record a trade outcome for online learning. Adds the sample to the feature
 * store and triggers automatic retraining when 50+ new samples have accumulated
 * since the last training run.
 *
 * @param {object} features — feature name/value pairs
 * @param {number} outcome — 1 = win, 0 = loss
 * @param {object} [opts]
 * @param {string} [opts.storePath] — override feature store path
 * @param {string} [opts.modelPath] — override model path
 */
function recordOutcome(features, outcome, opts) {
  const options = opts || {};
  const store = new FeatureStore(options.storePath);
  store.addSample(features, outcome);

  if (store.shouldRetrain()) {
    log.info('Auto-retraining', { samples: store.size(), retrainInterval: RETRAIN_INTERVAL });
    try {
      trainModel({
        storePath: options.storePath,
        modelPath: options.modelPath,
      });
    } catch (err) {
      log.error('Auto-retrain failed', { error: err.message });
    }
  }
}

// ─── getMLSignalBoost ────────────────────────────────────────────────────────

/**
 * Compute an ML-adjusted confidence score for a trading signal.
 *
 * Blends the edge-detector's original confidence with the ML model's win
 * probability: 70% original + 30% ML prediction.
 *
 * @param {object} signal — from edge-detector: { side, confidence, edge, compositeScore }
 * @param {object} components — from edge-detector signal.components
 * @param {object} [opts]
 * @param {string} [opts.modelPath] — override model path
 * @returns {{ adjustedConfidence: number, mlPrediction: number, shouldTrade: boolean }}
 */
function getMLSignalBoost(signal, components, opts) {
  const extracted = extractFeatures(signal, components);
  const prediction = predict(extracted.values, opts);

  const originalConfidence = (signal && signal.confidence != null) ? signal.confidence : 0.5;
  const adjustedConfidence = 0.7 * originalConfidence + 0.3 * prediction.winProbability;

  return {
    adjustedConfidence,
    mlPrediction: prediction.winProbability,
    shouldTrade: prediction.shouldTrade,
  };
}

// ─── K-Fold Cross-Validation ─────────────────────────────────────────────────

/**
 * Run k-fold cross-validation on the feature store data.
 * Returns average accuracy and per-fold metrics for hyperparameter selection.
 *
 * @param {object} [opts]
 * @param {number} [opts.k=5] — number of folds
 * @param {number} [opts.numStumps=50] — boosting rounds per fold
 * @param {number} [opts.learningRate=0.1] — learning rate per fold
 * @param {string} [opts.storePath] — override feature store path
 * @returns {{ avgValAccuracy, folds, bestFold, worstFold }}
 */
function crossValidate(opts) {
  const options = opts || {};
  const k = Math.max(2, Math.min(10, options.k || 5));
  const store = new FeatureStore(options.storePath);
  const samples = store.getSamples();

  if (samples.length < k * 10) {
    return { avgValAccuracy: 0, error: 'insufficient_samples', needed: k * 10, have: samples.length };
  }

  // Convert to matrices
  const X = [], y = [];
  for (const s of samples) {
    const row = new Array(FEATURE_NAMES.length);
    for (let f = 0; f < FEATURE_NAMES.length; f++) {
      const val = s.features?.[FEATURE_NAMES[f]];
      row[f] = (val != null && Number.isFinite(val)) ? val : 0;
    }
    X.push(row);
    y.push(s.label);
  }

  // Deterministic shuffle
  const indices = Array.from({ length: X.length }, (_, i) => i);
  let seed = (X.length * 2654435761) & 0x7fffffff || 1;
  function xorshift() {
    seed ^= (seed << 13) & 0x7fffffff;
    seed ^= (seed >> 17);
    seed ^= (seed << 5) & 0x7fffffff;
    seed = seed & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(xorshift() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  const foldSize = Math.floor(indices.length / k);
  const foldResults = [];

  for (let fold = 0; fold < k; fold++) {
    const valStart = fold * foldSize;
    const valEnd = fold === k - 1 ? indices.length : (fold + 1) * foldSize;

    const valIndices = indices.slice(valStart, valEnd);
    const trainIndices = [...indices.slice(0, valStart), ...indices.slice(valEnd)];

    const trainX = trainIndices.map(i => X[i]);
    const trainY = trainIndices.map(i => y[i]);
    const valX = valIndices.map(i => X[i]);
    const valY = valIndices.map(i => y[i]);

    const model = new GradientBoostedModel();
    model.train(trainX, trainY, {
      numStumps: options.numStumps || 50,
      learningRate: options.learningRate || 0.1,
      featureNames: FEATURE_NAMES,
    });

    const preds = model.predictBatch(valX);
    let correct = 0;
    for (let i = 0; i < valX.length; i++) {
      if ((preds[i] >= 0.5 ? 1 : 0) === valY[i]) correct++;
    }
    const accuracy = valX.length > 0 ? (correct / valX.length) * 100 : 0;

    foldResults.push({
      fold: fold + 1,
      trainSize: trainX.length,
      valSize: valX.length,
      accuracy: Math.round(accuracy * 100) / 100,
    });
  }

  const avgAcc = foldResults.reduce((s, f) => s + f.accuracy, 0) / foldResults.length;
  const sorted = [...foldResults].sort((a, b) => a.accuracy - b.accuracy);

  return {
    avgValAccuracy: Math.round(avgAcc * 100) / 100,
    folds: foldResults,
    bestFold: sorted[sorted.length - 1],
    worstFold: sorted[0],
    k,
    samples: samples.length,
  };
}

// ─── Ensemble Model (Bagging) ────────────────────────────────────────────────

/**
 * Ensemble of multiple GBMs trained with different hyperparameters and
 * random subsamples (bagging). Predictions are averaged across all models.
 */
class EnsembleModel {
  constructor() {
    /** @type {GradientBoostedModel[]} */
    this.models = [];
    /** @type {number[]} */
    this.weights = [];
  }

  /**
   * Train an ensemble of GBMs with varying hyperparameters.
   * @param {number[][]} X — feature matrix
   * @param {number[]} y — labels
   * @param {object} [opts]
   * @param {number} [opts.numModels=5]
   * @param {number} [opts.subsampleRatio=0.8]
   */
  train(X, y, opts) {
    const numModels = (opts?.numModels) || 5;
    const subsampleRatio = (opts?.subsampleRatio) || 0.8;
    this.models = [];
    this.weights = [];

    const hyperparamGrid = [
      { numStumps: 30, learningRate: 0.15 },
      { numStumps: 50, learningRate: 0.10 },
      { numStumps: 70, learningRate: 0.08 },
      { numStumps: 50, learningRate: 0.05 },
      { numStumps: 100, learningRate: 0.05 },
    ];

    for (let m = 0; m < numModels; m++) {
      const params = hyperparamGrid[m % hyperparamGrid.length];

      // Bootstrap sample
      const sampleSize = Math.floor(X.length * subsampleRatio);
      const bootX = [], bootY = [];
      for (let i = 0; i < sampleSize; i++) {
        const idx = Math.floor(Math.random() * X.length);
        bootX.push(X[idx]);
        bootY.push(y[idx]);
      }

      const model = new GradientBoostedModel();
      model.train(bootX, bootY, {
        numStumps: params.numStumps,
        learningRate: params.learningRate,
        featureNames: FEATURE_NAMES,
      });

      this.models.push(model);
      this.weights.push(1.0); // Equal weight initially
    }
  }

  /**
   * Weighted average prediction across all ensemble members.
   * @param {number[]} features
   * @returns {number} probability in [0, 1]
   */
  predict(features) {
    if (this.models.length === 0) return 0.5;
    let totalWeight = 0, weightedSum = 0;
    for (let i = 0; i < this.models.length; i++) {
      const pred = this.models[i].predict(features);
      const w = this.weights[i] || 1;
      weightedSum += pred * w;
      totalWeight += w;
    }
    return totalWeight > 0 ? weightedSum / totalWeight : 0.5;
  }

  /**
   * Update ensemble weights based on recent prediction accuracy.
   * Models that performed better get higher weight (adaptive boosting-like).
   * @param {number[][]} valX — validation features
   * @param {number[]} valY — validation labels
   */
  updateWeights(valX, valY) {
    if (!valX.length) return;
    for (let m = 0; m < this.models.length; m++) {
      let correct = 0;
      for (let i = 0; i < valX.length; i++) {
        const pred = this.models[m].predict(valX[i]) >= 0.5 ? 1 : 0;
        if (pred === valY[i]) correct++;
      }
      const accuracy = correct / valX.length;
      // Weight = log(accuracy / (1 - accuracy + epsilon)) — AdaBoost-like
      const epsilon = 0.01;
      this.weights[m] = Math.max(0.1, Math.log((accuracy + epsilon) / (1 - accuracy + epsilon)));
    }
    // Normalize
    const sum = this.weights.reduce((s, w) => s + w, 0);
    if (sum > 0) {
      for (let i = 0; i < this.weights.length; i++) this.weights[i] /= sum;
    }
  }

  serialize() {
    return {
      models: this.models.map(m => m.serialize()),
      weights: this.weights,
    };
  }

  static deserialize(json) {
    const ensemble = new EnsembleModel();
    ensemble.models = (json.models || []).map(m => GradientBoostedModel.deserialize(m));
    ensemble.weights = json.weights || ensemble.models.map(() => 1 / ensemble.models.length);
    return ensemble;
  }

  getAggregatedImportance() {
    const combined = {};
    for (let m = 0; m < this.models.length; m++) {
      const importance = this.models[m].getFeatureImportance();
      const w = this.weights[m] || 1;
      for (const [feat, count] of Object.entries(importance)) {
        combined[feat] = (combined[feat] || 0) + count * w;
      }
    }
    return combined;
  }
}

// ─── Hyperparameter Search ───────────────────────────────────────────────────

/**
 * Grid search over GBM hyperparameters using cross-validation.
 * Returns the best hyperparameters found.
 *
 * @param {object} [opts]
 * @param {string} [opts.storePath] — override feature store path
 * @returns {{ bestParams, bestAccuracy, results }}
 */
function hyperparameterSearch(opts) {
  const options = opts || {};
  const paramGrid = [
    { numStumps: 30, learningRate: 0.15, k: 5 },
    { numStumps: 50, learningRate: 0.10, k: 5 },
    { numStumps: 70, learningRate: 0.08, k: 5 },
    { numStumps: 50, learningRate: 0.05, k: 5 },
    { numStumps: 100, learningRate: 0.05, k: 5 },
    { numStumps: 100, learningRate: 0.10, k: 5 },
    { numStumps: 30, learningRate: 0.05, k: 5 },
    { numStumps: 70, learningRate: 0.12, k: 5 },
  ];

  const results = [];
  let bestAccuracy = 0;
  let bestParams = paramGrid[0];

  for (const params of paramGrid) {
    try {
      const cv = crossValidate({
        k: params.k,
        numStumps: params.numStumps,
        learningRate: params.learningRate,
        storePath: options.storePath,
      });

      if (cv.avgValAccuracy > 0) {
        results.push({
          params: { numStumps: params.numStumps, learningRate: params.learningRate },
          avgValAccuracy: cv.avgValAccuracy,
          worstFold: cv.worstFold?.accuracy || 0,
        });

        if (cv.avgValAccuracy > bestAccuracy) {
          bestAccuracy = cv.avgValAccuracy;
          bestParams = params;
        }
      }
    } catch (e) {
      log.warn('Hyperparam search iteration failed', { params, error: e.message });
    }
  }

  results.sort((a, b) => b.avgValAccuracy - a.avgValAccuracy);

  return {
    bestParams: { numStumps: bestParams.numStumps, learningRate: bestParams.learningRate },
    bestAccuracy: Math.round(bestAccuracy * 100) / 100,
    results,
  };
}

// ─── Ensemble Training ───────────────────────────────────────────────────────

const ENSEMBLE_PATH = path.join(DATA_DIR, 'ml-ensemble-model.json');

/**
 * Train an ensemble model and persist it.
 */
function trainEnsemble(opts) {
  const options = opts || {};
  const store = new FeatureStore(options.storePath);
  const samples = store.getSamples();

  if (samples.length < MIN_TRAIN_SAMPLES) {
    return { trained: false, reason: 'insufficient_samples' };
  }

  const X = [], y = [];
  for (const s of samples) {
    const row = new Array(FEATURE_NAMES.length);
    for (let f = 0; f < FEATURE_NAMES.length; f++) {
      const val = s.features?.[FEATURE_NAMES[f]];
      row[f] = (val != null && Number.isFinite(val)) ? val : 0;
    }
    X.push(row);
    y.push(s.label);
  }

  // 85/15 split for weight calibration
  const splitIdx = Math.floor(X.length * 0.85);
  const trainX = X.slice(0, splitIdx);
  const trainY = y.slice(0, splitIdx);
  const calX = X.slice(splitIdx);
  const calY = y.slice(splitIdx);

  const ensemble = new EnsembleModel();
  ensemble.train(trainX, trainY, { numModels: 5, subsampleRatio: 0.8 });

  // Calibrate weights on held-out set
  if (calX.length > 10) {
    ensemble.updateWeights(calX, calY);
  }

  // Evaluate
  let correct = 0;
  for (let i = 0; i < calX.length; i++) {
    if ((ensemble.predict(calX[i]) >= 0.5 ? 1 : 0) === calY[i]) correct++;
  }
  const calAccuracy = calX.length > 0 ? (correct / calX.length) * 100 : 0;

  if (calAccuracy > 55) {
    const serialized = ensemble.serialize();
    serialized.trainedAt = new Date().toISOString();
    serialized.calAccuracy = Math.round(calAccuracy * 100) / 100;
    serialized.sampleCount = samples.length;
    writeJson(options.ensemblePath || ENSEMBLE_PATH, serialized);
    log.info('Ensemble model saved', { calAccuracy: serialized.calAccuracy, models: ensemble.models.length });
  }

  return {
    trained: calAccuracy > 55,
    calAccuracy: Math.round(calAccuracy * 100) / 100,
    models: ensemble.models.length,
    samples: samples.length,
    featureImportance: ensemble.getAggregatedImportance(),
  };
}

/**
 * Get ML signal boost using ensemble model (with GBM fallback).
 * Blends both single GBM and ensemble predictions for robustness.
 */
function getEnsembleSignalBoost(signal, components, opts) {
  const extracted = extractFeatures(signal, components);

  // Single GBM prediction
  const gbmPred = predict(extracted.values, opts);

  // Ensemble prediction
  let ensemblePred = { winProbability: 0.5, confidence: 0 };
  try {
    const ensembleData = readJson(opts?.ensemblePath || ENSEMBLE_PATH, null);
    if (ensembleData?.models?.length > 0) {
      const ensemble = EnsembleModel.deserialize(ensembleData);
      const prob = ensemble.predict(extracted.values);
      ensemblePred = { winProbability: prob, confidence: Math.abs(prob - 0.5) * 2 };
    }
  } catch { /* ensemble not available */ }

  // Blend: 40% original confidence + 30% GBM + 30% ensemble
  const originalConf = signal?.confidence || 0.5;
  const adjustedConfidence = 0.4 * originalConf + 0.3 * gbmPred.winProbability + 0.3 * ensemblePred.winProbability;

  return {
    adjustedConfidence,
    gbmPrediction: gbmPred.winProbability,
    ensemblePrediction: ensemblePred.winProbability,
    shouldTrade: gbmPred.shouldTrade || ensemblePred.winProbability > 0.55,
    source: ensemblePred.confidence > 0 ? 'ensemble+gbm' : 'gbm_only',
  };
}

// ─── Force Retrain & Status ──────────────────────────────────────────────────

/**
 * Force retrain both GBM and ensemble models.
 */
function forceRetrain(opts) {
  log.info('Force retraining triggered');
  const gbmResult = trainModel(opts);
  const ensembleResult = trainEnsemble(opts);
  return { gbm: gbmResult, ensemble: ensembleResult };
}

/**
 * Get comprehensive ML pipeline status.
 */
function getMLStatus(opts) {
  const store = new FeatureStore(opts?.storePath);
  const modelData = readJson(opts?.modelPath || MODEL_PATH, null);
  const ensembleData = readJson(opts?.ensemblePath || ENSEMBLE_PATH, null);

  return {
    sampleCount: store.size(),
    needsRetrain: store.shouldRetrain(),
    gbmModel: modelData ? {
      trainedAt: modelData.trainedAt,
      valAccuracy: modelData.valAccuracy,
      sampleCount: modelData.sampleCount,
      stumps: modelData.stumps?.length || 0,
    } : null,
    ensembleModel: ensembleData ? {
      trainedAt: ensembleData.trainedAt,
      calAccuracy: ensembleData.calAccuracy,
      models: ensembleData.models?.length || 0,
    } : null,
    featureNames: FEATURE_NAMES,
  };
}

// ─── Record Trade Outcome (Alias) ───────────────────────────────────────────

/**
 * Alias for `recordOutcome` matching the export name used by other modules.
 */
function recordTradeOutcome(features, outcome, opts) {
  return recordOutcome(features, outcome, opts);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  FeatureStore,
  GradientBoostedModel,
  EnsembleModel,
  extractFeatures,
  trainModel,
  trainEnsemble,
  crossValidate,
  hyperparameterSearch,
  predict,
  recordOutcome,
  recordTradeOutcome,
  getMLSignalBoost,
  getEnsembleSignalBoost,
  forceRetrain,
  getMLStatus,
};
