import { readFile } from 'node:fs/promises';

export function validateLives(lives) {
  if (!Array.isArray(lives) || lives.length === 0) throw new Error('Expected nonempty engine lives');
  const ids = new Set();
  for (const life of lives) {
    if (!Number.isInteger(life.id) || life.id <= 0 || ids.has(life.id)) throw new Error('Engine IDs must be unique positive integers');
    ids.add(life.id);
    if (!Array.isArray(life.rows) || !life.rows.length) throw new Error(`Engine ${life.id} has no rows`);
    for (let i = 0; i < life.rows.length; i++) {
      const row = life.rows[i];
      if (row.cycle !== i + 1) throw new Error(`Engine ${life.id} cycles must be contiguous from 1`);
      if (!Array.isArray(row.settings) || row.settings.length !== 3 || !row.settings.every(Number.isFinite)) throw new Error(`Engine ${life.id} invalid settings`);
      if (!Array.isArray(row.sensors) || !row.sensors.length || !row.sensors.every(Number.isFinite)) throw new Error(`Engine ${life.id} invalid sensors`);
    }
    const width = life.rows[0].sensors.length;
    if (life.rows.some(row => row.sensors.length !== width)) throw new Error(`Engine ${life.id} sensor width varies`);
  }
  return lives;
}

export async function loadToy(path = 'tests/fixtures/toy-lives.json') {
  const compact = JSON.parse(await readFile(path, 'utf8'));
  return validateLives(compact.map(({ id, sensorSeries }) => ({ id, rows: sensorSeries.map((value, index) => ({ cycle: index + 1, settings: [0, 0, 0], sensors: [value] })) })));
}

export function parseFd001(text) {
  const byId = new Map();
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const fields = line.trim().split(/\s+/).map(Number);
    if (fields.length !== 26 || !fields.every(Number.isFinite)) throw new Error(`Invalid FD001 row ${index + 1}: expected 26 finite fields`);
    const [id, cycle, ...values] = fields;
    if (!Number.isInteger(id) || !Number.isInteger(cycle)) throw new Error(`Invalid ID or cycle at row ${index + 1}`);
    if (!byId.has(id)) byId.set(id, { id, rows: [] });
    byId.get(id).rows.push({ cycle, settings: values.slice(0, 3), sensors: values.slice(3) });
  }
  return validateLives([...byId.values()]);
}

export async function loadFd001(path) { return parseFd001(await readFile(path, 'utf8')); }

// Engine-level seeded shuffle; no rows or windows can cross partitions.
export function splitLives(lives, seed = 23, fractions = [0.5, 0.25, 0.25]) {
  validateLives(lives);
  if (fractions.length !== 3 || fractions.some(x => x <= 0) || Math.abs(fractions.reduce((a, b) => a + b, 0) - 1) > 1e-9) throw new Error('Invalid split fractions');
  let state = seed >>> 0;
  const random = () => { state = (1664525 * state + 1013904223) >>> 0; return state / 2 ** 32; };
  const shuffled = [...lives].sort((a, b) => a.id - b.id);
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  const nTrain = Math.floor(lives.length * fractions[0]);
  const nVal = Math.floor(lives.length * fractions[1]);
  if (!nTrain || !nVal || nTrain + nVal >= lives.length) throw new Error('Not enough engines for three splits');
  return { train: shuffled.slice(0, nTrain), validation: shuffled.slice(nTrain, nTrain + nVal), test: shuffled.slice(nTrain + nVal) };
}
