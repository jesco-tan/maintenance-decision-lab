export const fixedInterval = interval => ({ name: `fixed-${interval}`, request: ({ cycle }) => ({ request: cycle >= interval, risk: null, priority: cycle }) });
export const sensorThreshold = (threshold, sensorIndex = 0, direction = 1) => ({ name: `sensor-${sensorIndex + 1}-${direction > 0 ? 'high' : 'low'}-${threshold}`, request: ({ history }) => {
  const value = history.at(-1).sensors[sensorIndex] * direction;
  return { request: value >= threshold * direction, risk: null, priority: value };
} });
export const learnedRisk = (model, threshold) => ({ name: `risk-${threshold}`, request: ({ history }) => {
  const risk = model.predict(history);
  return { request: risk >= threshold, risk, priority: risk };
} });
// Unattainable reference: explicitly uses the true failure cycle.
export const oracle = () => ({ name: 'oracle', isOracle: true, request: ({ cycle, failureCycle }) => ({ request: cycle === failureCycle, risk: null, priority: -failureCycle }) });

// Full-trajectory reference: schedule each life in the latest free slot no later than failure.
// With these equal per-engine costs, this is an unattainable capacity-aware timing reference.
export function perfectKnowledgeSchedule(lives, slotsPerCycle, startCycles = {}) {
  const free = new Map();
  const schedule = new Map();
  for (const life of [...lives].sort((a, b) => (startCycles[a.id] ?? 1) + a.rows.length - (startCycles[b.id] ?? 1) - b.rows.length || a.id - b.id)) {
    const start = startCycles[life.id] ?? 1;
    for (let period = start + life.rows.length - 1; period >= start; period--) {
      const used = free.get(period) ?? 0;
      if (used < slotsPerCycle) { free.set(period, used + 1); schedule.set(life.id, period); break; }
    }
  }
  return { name: 'perfect-knowledge-schedule', isOracle: true, request: ({ engineId, period, failureCycle }) => ({ request: schedule.get(engineId) === period, risk: null, priority: -failureCycle }) };
}
