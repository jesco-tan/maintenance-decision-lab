import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLives, parseFd001, splitLives, loadToy } from '../src/maintenance/data.js';
import { fixedInterval, sensorThreshold, oracle, perfectKnowledgeSchedule } from '../src/maintenance/policies.js';
import { simulate } from '../src/maintenance/simulator.js';
import { fitRisk, calibrateRisk, trainingExamples, predictionMetrics } from '../src/maintenance/risk.js';

const life = (id, values) => ({ id, rows: values.map((value, i) => ({ cycle: i + 1, settings: [0, 0, 0], sensors: [value] })) });
const assumptions = { replacementCost: 1, failureCost: 5, slotsPerCycle: 1 };

test('current cycle observation precedes end-of-cycle failure', () => {
  const lives = [life(1, [0, 0.5, 1])];
  const atThree = simulate(lives, fixedInterval(3), assumptions);
  assert.equal(atThree.totalCost, 1);
  assert.equal(atThree.failures, 0);
  assert.equal(atThree.trace.at(-1).unusedLife, 0);
  const late = simulate(lives, fixedInterval(4), assumptions);
  assert.equal(late.totalCost, 5);
  assert.equal(late.trace.at(-1).consequence, 'unexpected_failure');
});

test('two requests compete for one slot with deterministic priority', () => {
  const result = simulate([life(1, [0, 0.8]), life(2, [0, 0.9])], sensorThreshold(0.7), assumptions);
  assert.deepEqual(result.outcomes.map(x => [x.engineId, x.outcome]), [[1, 'unexpected_failure'], [2, 'planned_replacement']]);
  assert.equal(result.totalCost, 6);
  assert.equal(result.usedSlots, 1);
  assert.equal(result.offeredSlots, 2);
});

test('policy cannot see future rows or true failure cycle', () => {
  const policy = { name: 'audit', request(observation) {
    assert.equal(observation.history.length, observation.cycle);
    assert.equal('failureCycle' in observation, false);
    assert.equal(observation.history.at(-1).cycle, observation.cycle);
    return { request: false, risk: null };
  } };
  simulate([life(1, [0.1, 0.2, 0.3])], policy, assumptions);
});

test('oracle reference observes failure cycle and can replace at final cycle', () => {
  assert.equal(simulate([life(1, [0.1, 0.2])], oracle(), assumptions).totalCost, 1);
});

test('perfect-knowledge schedule resolves shared deadlines before failure', () => {
  const lives = [life(1, [0.1, 0.2]), life(2, [0.1, 0.2])];
  const result = simulate(lives, perfectKnowledgeSchedule(lives, 1), { ...assumptions, unusedLifeCostPerCycle: 0.1 });
  assert.equal(result.failures, 0);
  assert.equal(result.unusedLife, 1);
  assert.equal(result.totalCost, 2.1);
});

test('staggered starts share calendar capacity but keep local age and prefix', () => {
  const lives = [life(1, [0.1, 0.2]), life(2, [0.1, 0.2])];
  const starts = { 1: 1, 2: 2 };
  const policy = { name: 'audit-stagger', request({ engineId, cycle, period, history }) {
    assert.equal(cycle, period - starts[engineId] + 1);
    assert.equal(history.length, cycle);
    return { request: cycle === 2, risk: null };
  } };
  const result = simulate(lives, policy, { ...assumptions, startCycles: starts });
  assert.equal(result.failures, 0);
  assert.deepEqual(result.outcomes.map(x => x.period), [2, 3]);
  assert.equal(result.offeredSlots, 3);
  const oracleResult = simulate(lives, perfectKnowledgeSchedule(lives, 1, starts), { ...assumptions, startCycles: starts });
  assert.equal(oracleResult.unusedLife, 0);
});

test('staggered contention happens by calendar period', () => {
  const lives = [life(1, [0.1, 0.2]), life(2, [0.1])];
  const policy = { name: 'contend', request: ({ engineId, cycle }) => ({ request: engineId === 2 || cycle === 2, risk: null }) };
  const result = simulate(lives, policy, { ...assumptions, startCycles: { 1: 1, 2: 2 } });
  assert.equal(result.usedSlots, 1);
  assert.equal(result.failures, 1);
  assert.equal(result.trace.filter(x => x.period === 2 && x.requested).length, 2);
});

test('early replacement records unused life and zero capacity forces failure', () => {
  const lives = [life(1, [0.1, 0.2, 0.3, 0.4])];
  const early = simulate(lives, fixedInterval(2), assumptions);
  assert.equal(early.outcomes[0].unusedLife, 2);
  assert.equal(early.totalCost, 1);
  assert.equal(simulate(lives, fixedInterval(2), { ...assumptions, unusedLifeCostPerCycle: 0.1 }).totalCost, 1.2);
  const denied = simulate(lives, fixedInterval(2), { ...assumptions, slotsPerCycle: 0 });
  assert.equal(denied.totalCost, 5);
  assert.equal(denied.usedSlots, 0);
  assert.equal(denied.trace.at(-1).consequence, 'unexpected_failure');
});

test('loader rejects missingness, gaps, duplicate IDs and wrong FD001 width', () => {
  assert.throws(() => validateLives([life(1, [0.1]), life(1, [0.2])]), /unique/);
  assert.throws(() => validateLives([{ id: 1, rows: [{ cycle: 2, settings: [0, 0, 0], sensors: [1] }] }]), /contiguous/);
  assert.throws(() => validateLives([life(1, [NaN])]), /invalid sensors/);
  assert.throws(() => parseFd001('1 1 0 0 0 1'), /26/);
  const row = [1, 1, 0, 0, 0, ...Array(21).fill(0)].join(' ');
  assert.equal(parseFd001(row)[0].rows[0].sensors.length, 21);
});

test('engine-level splits are disjoint and risk labels use only train lives', async () => {
  const split = splitLives(await loadToy(), 23);
  const ids = Object.values(split).flatMap(group => group.map(life => life.id));
  assert.equal(new Set(ids).size, ids.length);
  const model = fitRisk(split.train, 2);
  assert.ok(model.predict(split.test[0].rows.slice(0, 1)) >= 0);
  const alteredTest = split.test.map((engine, index) => index ? engine : life(engine.id, [999, 999]));
  const modelAgain = fitRisk(split.train, 2);
  assert.deepEqual(modelAgain.means, model.means);
  assert.notEqual(model.predict(alteredTest[0].rows.slice(0, 1)), model.predict(split.test[0].rows.slice(0, 1)));
  const calibrated = calibrateRisk(model, split.validation.slice(0, 1));
  assert.ok(Number.isFinite(predictionMetrics(calibrated, split.test).brier));
  const examples = trainingExamples([life(42, [0, 0.2, 0.4])], 2);
  assert.deepEqual(examples.map(x => x.y), [0, 1, 1]);
});
