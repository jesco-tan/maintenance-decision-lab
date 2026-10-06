import { execFileSync } from 'node:child_process';
import { readFile, unlink, writeFile } from 'node:fs/promises';

const scenarios = [
  { stagger: 0, unused: 0 }, { stagger: 0, unused: 0.01 },
  { stagger: 0, unused: 0.05 }, { stagger: 0, unused: 0.1 },
  { stagger: 60, unused: 0 }, { stagger: 60, unused: 0.01 },
  { stagger: 60, unused: 0.05 }, { stagger: 60, unused: 0.1 }
];
const rows = ['stagger_span,unused_life_cost_per_cycle,slots,failure_cost,policy,total_cost,cost_per_life,failures,unused_life'];
const temporaryFiles = [];
for (const { stagger, unused } of scenarios) {
  const keepTrace = stagger === 60 && unused === 0.01;
  const args = ['src/maintenance/evaluate.js', '--fd001', `--stagger=${stagger}`, `--unused-life-cost=${unused}`, ...(keepTrace ? [] : ['--compact'])];
  execFileSync(process.execPath, args, { stdio: 'pipe' });
  const suffix = `${stagger ? `-stagger${stagger}` : ''}-unused${unused}`;
  const reportPath = `outputs/report-fd001${suffix}.json`;
  const comparisonPath = `outputs/comparison-fd001${suffix}.csv`;
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  if (!keepTrace) temporaryFiles.push(reportPath, comparisonPath);
  for (const comparison of report.comparisons) for (const result of comparison.results) {
    rows.push([stagger, unused, comparison.assumptions.slotsPerCycle, comparison.assumptions.failureCost, result.kind, result.totalCost, result.costPerLife, result.failures, result.unusedLife].join(','));
  }
}
await writeFile('outputs/sensitivity-summary.csv', rows.join('\n') + '\n');
for (const path of temporaryFiles) await unlink(path);
console.log('Wrote outputs/sensitivity-summary.csv and detailed staggered trace for 8 scenario grids.');
