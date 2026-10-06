import { features } from './features.js';

const sigmoid = x => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const logit = p => Math.log(Math.max(1e-6, Math.min(1 - 1e-6, p)) / (1 - Math.max(1e-6, Math.min(1 - 1e-6, p))));

export function trainingExamples(lives, horizon) {
  if (!Number.isInteger(horizon) || horizon < 1) throw new Error('Risk horizon must be positive');
  return lives.flatMap(life => life.rows.map((_, index) => ({
    x: features(life.rows.slice(0, index + 1)),
    y: life.rows.length - (index + 1) < horizon ? 1 : 0,
    engineId: life.id,
    cycle: index + 1,
    lifeLength: life.rows.length
  })));
}

export function fitRisk(lives, horizon, { epochs = 300, rate = 0.08, penalty = 0.02 } = {}) {
  const examples = trainingExamples(lives, horizon);
  const width = examples[0].x.length;
  const means = Array.from({ length: width }, (_, i) => examples.reduce((s, e) => s + e.x[i], 0) / examples.length);
  const scales = means.map((mean, i) => Math.sqrt(examples.reduce((s, e) => s + (e.x[i] - mean) ** 2, 0) / examples.length) || 1);
  const weights = Array(width + 1).fill(0);
  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradient = Array(width + 1).fill(0);
    for (const example of examples) {
      const x = [1, ...example.x.map((v, i) => (v - means[i]) / scales[i])];
      const error = sigmoid(dot(weights, x)) - example.y;
      x.forEach((v, i) => { gradient[i] += error * v; });
    }
    weights.forEach((weight, i) => { weights[i] -= rate * (gradient[i] / examples.length + (i ? penalty * weight : 0)); });
  }
  return {
    horizon, means, scales, weights,
    predict(history) { const x = [1, ...features(history).map((v, i) => (v - means[i]) / scales[i])]; return sigmoid(dot(weights, x)); }
  };
}

// Platt recalibration on validation engines only. Fits slope and intercept of
// logit(base risk); a weak prior keeps sparse validation sets stable.
export function calibrateRisk(base, validationLives) {
  const examples = validationLives.flatMap(life => life.rows.map((_, index) => ({
    x: logit(base.predict(life.rows.slice(0, index + 1))),
    y: Number(life.rows.length - index - 1 < base.horizon)
  })));
  if (!examples.length) throw new Error('Calibration requires validation examples');
  let slope = 1, intercept = 0;
  const prior = 0.01;
  for (let iteration = 0; iteration < 30; iteration++) {
    let ga = prior * (slope - 1), gb = prior * intercept;
    let haa = prior, hab = 0, hbb = prior;
    for (const { x, y } of examples) {
      const p = sigmoid(slope * x + intercept);
      const error = p - y, curvature = p * (1 - p);
      ga += error * x; gb += error;
      haa += curvature * x * x; hab += curvature * x; hbb += curvature;
    }
    const determinant = haa * hbb - hab * hab;
    if (determinant <= 0) break;
    const da = (hbb * ga - hab * gb) / determinant;
    const db = (haa * gb - hab * ga) / determinant;
    slope -= Math.max(-1, Math.min(1, da));
    intercept -= Math.max(-1, Math.min(1, db));
    if (Math.max(Math.abs(da), Math.abs(db)) < 1e-7) break;
  }
  return { horizon: base.horizon, slope, intercept, predict(history) { return sigmoid(slope * logit(base.predict(history)) + intercept); } };
}

export function predictionMetrics(model, lives) {
  const examples = trainingExamples(lives, model.horizon);
  const predictions = lives.flatMap(life => life.rows.map((_, index) => model.predict(life.rows.slice(0, index + 1))));
  const brier = examples.reduce((s, e, i) => s + (predictions[i] - e.y) ** 2, 0) / examples.length;
  const bins = [[0, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 1]].map(([low, high]) => {
    const selected = examples.map((example, i) => ({ ...example, prediction: predictions[i] })).filter(x => x.prediction >= low && (high === 1 ? x.prediction <= high : x.prediction < high));
    return { range: [low, high], n: selected.length, predicted: selected.length ? selected.reduce((s, e) => s + e.prediction, 0) / selected.length : null, observed: selected.length ? selected.reduce((s, e) => s + e.y, 0) / selected.length : null };
  });
  const byPhase = Object.fromEntries(['early', 'late'].map(phase => {
    const indices = examples.flatMap((example, i) => ((example.cycle / example.lifeLength <= 0.5) === (phase === 'early') ? [i] : []));
    return [phase, { n: indices.length, brier: indices.reduce((s, i) => s + (predictions[i] - examples[i].y) ** 2, 0) / indices.length }];
  }));
  return { n: examples.length, brier, bins, byPhase };
}
