import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadToy, loadFd001, splitLives } from './data.js';
import { fitRisk, calibrateRisk, predictionMetrics } from './risk.js';
import { fixedInterval, sensorThreshold, learnedRisk, perfectKnowledgeSchedule } from './policies.js';
import { simulate } from './simulator.js';

const config = JSON.parse(await readFile('config/default.json', 'utf8'));
const fd001 = process.argv.includes('--fd001');
const compact = process.argv.includes('--compact');
const seedArgument = process.argv.find(arg => arg.startsWith('--seed='));
const splitSeed = seedArgument ? Number(seedArgument.slice('--seed='.length)) : config.splitSeed;
if (!Number.isInteger(splitSeed) || splitSeed < 0) throw new Error('Seed must be a nonnegative integer');
const staggerArgument = process.argv.find(arg => arg.startsWith('--stagger='));
const staggerSpan = staggerArgument ? Number(staggerArgument.slice('--stagger='.length)) : 0;
if (!Number.isInteger(staggerSpan) || staggerSpan < 0) throw new Error('Stagger span must be a nonnegative integer');
const unusedCostArgument = process.argv.find(arg => arg.startsWith('--unused-life-cost='));
const unusedLifeCostPerCycle = unusedCostArgument ? Number(unusedCostArgument.slice('--unused-life-cost='.length)) : config.unusedLifeCostPerCycle;
if (!Number.isFinite(unusedLifeCostPerCycle) || unusedLifeCostPerCycle < 0) throw new Error('Unused-life cost must be nonnegative');
const lives = fd001 ? await loadFd001('data/raw/train_FD001.txt') : await loadToy();
const split = splitLives(lives, splitSeed);
const horizon = fd001 ? 15 : config.riskHorizon;
const baseModel = fitRisk(split.train, horizon);
const calibrationLives = fd001 ? split.validation.slice(0, 12) : split.validation.slice(0, 1);
const tuningLives = fd001 ? split.validation.slice(12) : split.validation.slice(1);
if (!tuningLives.length) throw new Error('Need separate engines for calibration and policy tuning');
const model = calibrateRisk(baseModel, calibrationLives);
const startCyclesFor = group => Object.fromEntries(group.map(life => [life.id, staggerSpan ? 1 + (((Math.imul(life.id, 2654435761) + splitSeed) >>> 0) % staggerSpan) : 1]));
const validationStarts = startCyclesFor(tuningLives);
const testStarts = startCyclesFor(split.test);
let officialTruncatedPrediction = null;
if (fd001) {
  const testLives = await loadFd001('data/raw/test_FD001.txt');
  const rul = (await readFile('data/raw/RUL_FD001.txt', 'utf8')).match(/\d+/g)?.map(Number) ?? [];
  if (testLives.length !== rul.length || !rul.every(x => Number.isInteger(x) && x > 0)) throw new Error('Invalid official FD001 RUL labels');
  const snapshots = testLives.map((life, i) => ({ risk: model.predict(life.rows), rawRisk: baseModel.predict(life.rows), observed: Number(rul[i] < horizon) }));
  officialTruncatedPrediction = {
    description: 'One last observed snapshot per official truncated FD001 test engine; prediction only, no policy replay',
    n: snapshots.length,
    positives: snapshots.reduce((s, x) => s + x.observed, 0),
    rawBrier: snapshots.reduce((s, x) => s + (x.rawRisk - x.observed) ** 2, 0) / snapshots.length,
    brier: snapshots.reduce((s, x) => s + (x.risk - x.observed) ** 2, 0) / snapshots.length,
    bins: [[0, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 1]].map(([low, high]) => {
      const group = snapshots.filter(x => x.risk >= low && (high === 1 ? x.risk <= high : x.risk < high));
      return { range: [low, high], n: group.length, predicted: group.length ? group.reduce((s, x) => s + x.risk, 0) / group.length : null, observed: group.length ? group.reduce((s, x) => s + x.observed, 0) / group.length : null };
    })
  };
}
function selectSensor(train) {
  const width = train[0].rows[0].sensors.length;
  const examples = train.flatMap(life => life.rows.map((row, i) => ({ sensors: row.sensors, y: Number(life.rows.length - i - 1 < horizon) })));
  const scores = Array.from({ length: width }, (_, index) => {
    const values = examples.map(x => x.sensors[index]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const pos = examples.filter(x => x.y).map(x => x.sensors[index]);
    const neg = examples.filter(x => !x.y).map(x => x.sensors[index]);
    const difference = pos.reduce((a, b) => a + b, 0) / pos.length - neg.reduce((a, b) => a + b, 0) / neg.length;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) || 1;
    return { index, direction: Math.sign(difference) || 1, score: Math.abs(difference / sd) };
  });
  return scores.sort((a, b) => b.score - a.score || a.index - b.index)[0];
}
const sensor = selectSensor(split.train);
const sensorValues = split.train.flatMap(life => life.rows.map(row => row.sensors[sensor.index])).sort((a, b) => a - b);
const quantiles = fd001 ? [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95] : [0.35, 0.45, 0.55, 0.65, 0.75, 0.85];
const sensorThresholds = fd001 ? quantiles.map(q => sensorValues[Math.floor((sensor.direction > 0 ? q : 1 - q) * (sensorValues.length - 1))]) : quantiles;
const candidates = {
  fixed: (fd001 ? Array.from({ length: 26 }, (_, i) => 80 + i * 10) : [3, 4, 5, 6, 7, 8]).map(fixedInterval),
  sensor: sensorThresholds.map(t => sensorThreshold(t, sensor.index, sensor.direction)),
  risk: (fd001 ? [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] : [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]).map(t => learnedRisk(model, t))
};
function tune(kind, assumptions) {
  return candidates[kind].map(policy => ({ policy, result: simulate(tuningLives, policy, { ...assumptions, startCycles: validationStarts }) }))
    .sort((a, b) => a.result.totalCost - b.result.totalCost || a.result.failures - b.result.failures || a.result.unusedLife - b.result.unusedLife || a.policy.name.localeCompare(b.policy.name))[0].policy;
}
const ratios = [2, 5, 10];
const slotLimits = fd001 ? [1, 2, 5] : [1, 2];
const comparisons = [];
const traces = {};
for (const slotsPerCycle of slotLimits) for (const ratio of ratios) {
  const assumptions = { replacementCost: config.replacementCost, failureCost: ratio * config.replacementCost, unusedLifeCostPerCycle, slotsPerCycle };
  const tuned = Object.fromEntries(['fixed', 'sensor', 'risk'].map(kind => [kind, tune(kind, assumptions)]));
  const results = Object.entries({ ...tuned, oracle: perfectKnowledgeSchedule(split.test, slotsPerCycle, testStarts) }).map(([kind, policy]) => {
    const result = simulate(split.test, policy, { ...assumptions, startCycles: testStarts });
    if (!compact && ratio === config.failureCost / config.replacementCost && slotsPerCycle === config.slotsPerCycle) traces[kind] = result.trace;
    return { kind, policy: policy.name, totalCost: result.totalCost, costPerLife: result.costPerLife, planned: result.planned, failures: result.failures, unusedLife: result.unusedLife, costBreakdown: result.costBreakdown, usedSlots: result.usedSlots, offeredSlots: result.offeredSlots, utilization: result.utilization, outcomes: result.outcomes };
  });
  comparisons.push({ assumptions, results });
}
const manifest = {
  source: fd001 ? 'local extracted NASA CMAPSS FD001 complete training trajectories; simulated interventions' : 'self-authored toy-lives.json; no NASA data',
  splitSeed,
  engineIds: Object.fromEntries(Object.entries(split).map(([key, group]) => [key, group.map(life => life.id)])),
  validationRoles: { calibration: calibrationLives.map(x => x.id), policyTuning: tuningLives.map(x => x.id) },
  startCycles: { policyTuning: validationStarts, heldOutTest: testStarts },
  staggerSpan,
  compact,
  riskHorizon: horizon,
  selectedSensor: sensor,
  model: { type: 'regularized logistic regression with Platt recalibration', features: ['current cycle', 'three current settings', 'all current sensors', 'all one-cycle sensor differences'], standardization: 'training engines only', weights: baseModel.weights, means: baseModel.means, scales: baseModel.scales, calibration: { slope: model.slope, intercept: model.intercept, fittedEngineIds: calibrationLives.map(x => x.id) } },
  prediction: { rawTuning: predictionMetrics(baseModel, tuningLives), calibratedTuning: predictionMetrics(model, tuningLives), rawTest: predictionMetrics(baseModel, split.test), calibratedTest: predictionMetrics(model, split.test), officialTruncatedTest: officialTruncatedPrediction },
  assumptions: 'At each cycle, observe current sensors, allocate planned slots, then an unreplaced engine fails at the end of its final observed cycle. Replacement or failure ends that single life. Costs are dimensionless. Early replacement adds an assumed cost per discarded observed cycle. No second life, operating cost, downtime duration, inspection, or real safety outcome is modeled.',
  comparisons,
  traces
};
await mkdir('outputs', { recursive: true });
const suffix = `${fd001 ? '-fd001' : ''}${seedArgument ? `-seed${splitSeed}` : ''}${staggerSpan ? `-stagger${staggerSpan}` : ''}${unusedCostArgument ? `-unused${unusedLifeCostPerCycle}` : ''}`;
await writeFile(`outputs/report${suffix}.json`, JSON.stringify(manifest, null, 2) + '\n');
const rows = ['slots,replacement_cost,failure_cost,unused_life_cost_per_cycle,policy,selected_rule,cost_per_life,total_cost,planned_cost,failure_cost_total,unused_life_cost_total,planned,failures,unused_life,slot_utilization'];
for (const item of comparisons) for (const result of item.results) rows.push([item.assumptions.slotsPerCycle, item.assumptions.replacementCost, item.assumptions.failureCost, item.assumptions.unusedLifeCostPerCycle, result.kind, result.policy, result.costPerLife, result.totalCost, result.costBreakdown.planned, result.costBreakdown.unexpectedFailure, result.costBreakdown.unusedLife, result.planned, result.failures, result.unusedLife, result.utilization].join(','));
await writeFile(`outputs/comparison${suffix}.csv`, rows.join('\n') + '\n');
console.log(rows.join('\n'));
console.log(`Wrote outputs/report${suffix}.json and outputs/comparison${suffix}.csv`);
