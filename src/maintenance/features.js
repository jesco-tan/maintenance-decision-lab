// Only the supplied prefix is accessible. Callers must pass rows through the current cycle.
export function features(history) {
  if (!history.length) throw new Error('Empty history');
  const current = history.at(-1);
  const previous = history.length > 1 ? history.at(-2) : current;
  return [current.cycle, ...current.settings, ...current.sensors, ...current.sensors.map((value, i) => value - previous.sensors[i])];
}
