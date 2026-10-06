import { validateLives } from './data.js';

export function simulate(lives, policy, { failureCost, replacementCost, unusedLifeCostPerCycle = 0, slotsPerCycle, startCycles = {} }) {
  validateLives(lives);
  if (!(failureCost >= 0) || !(replacementCost >= 0) || !(unusedLifeCostPerCycle >= 0) || !Number.isInteger(slotsPerCycle) || slotsPerCycle < 0) throw new Error('Invalid simulation costs or slots');
  const active = new Set(lives.map(life => life.id));
  for (const life of lives) if (!Number.isInteger(startCycles[life.id] ?? 1) || (startCycles[life.id] ?? 1) < 1) throw new Error('Start cycles must be positive integers');
  const trace = [];
  let offeredSlots = 0;
  let usedSlots = 0;
  const maxPeriod = Math.max(...lives.map(life => (startCycles[life.id] ?? 1) + life.rows.length - 1));
  for (let period = 1; period <= maxPeriod && active.size; period++) {
    const candidates = [];
    const decisions = [];
    for (const life of lives) {
      if (!active.has(life.id)) continue;
      const start = startCycles[life.id] ?? 1;
      if (period < start) continue;
      const cycle = period - start + 1;
      const history = life.rows.slice(0, cycle);
      const observation = { engineId: life.id, cycle, period, history };
      if (policy.isOracle) observation.failureCycle = life.rows.length;
      const response = policy.request(observation);
      if (typeof response.request !== 'boolean' || (response.risk !== null && response.risk !== undefined && (!Number.isFinite(response.risk) || response.risk < 0 || response.risk > 1))) throw new Error('Invalid policy response');
      const decision = { engineId: life.id, cycle, period, estimatedRisk: response.risk ?? null, requested: response.request, priority: response.priority ?? 0, failureCycle: life.rows.length };
      decisions.push(decision);
      if (response.request) candidates.push(decision);
    }
    if (decisions.length) offeredSlots += slotsPerCycle;
    candidates.sort((a, b) => b.priority - a.priority || a.engineId - b.engineId);
    const selected = new Set(candidates.slice(0, slotsPerCycle).map(d => d.engineId));
    usedSlots += selected.size;
    for (const decision of decisions) {
      const replaced = selected.has(decision.engineId);
      const failed = !replaced && decision.cycle === decision.failureCycle;
      const consequence = replaced ? 'planned_replacement' : failed ? 'unexpected_failure' : 'operating';
      if (replaced || failed) active.delete(decision.engineId);
      const unusedLife = replaced ? decision.failureCycle - decision.cycle : 0;
      trace.push({ engineId: decision.engineId, cycle: decision.cycle, period: decision.period, estimatedRisk: decision.estimatedRisk, requested: decision.requested, availableSlots: slotsPerCycle, chosenAction: replaced ? 'replace' : 'continue', consequence, unusedLife, cost: replaced ? replacementCost + unusedLife * unusedLifeCostPerCycle : failed ? failureCost : 0 });
    }
  }
  const outcomes = lives.map(life => {
    const last = trace.filter(e => e.engineId === life.id).at(-1);
    return { engineId: life.id, outcome: last.consequence, cycle: last.cycle, period: last.period, cost: last.cost, unusedLife: last.unusedLife };
  });
  const planned = outcomes.filter(x => x.outcome === 'planned_replacement').length;
  const failures = outcomes.filter(x => x.outcome === 'unexpected_failure').length;
  const unusedLife = outcomes.reduce((s, x) => s + x.unusedLife, 0);
  const totalCost = planned * replacementCost + failures * failureCost + unusedLife * unusedLifeCostPerCycle;
  return { policy: policy.name, n: lives.length, totalCost, costPerLife: totalCost / lives.length, planned, failures, unusedLife, costBreakdown: { planned: planned * replacementCost, unexpectedFailure: failures * failureCost, unusedLife: unusedLife * unusedLifeCostPerCycle }, usedSlots, offeredSlots, utilization: offeredSlots ? usedSlots / offeredSlots : 0, outcomes, trace };
}
