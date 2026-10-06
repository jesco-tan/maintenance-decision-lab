# Maintenance Decision Lab

A dependency-free, single-life maintenance policy simulator. It compares fixed-cycle replacement, a sensor threshold, and a learned probability of failure within a short horizon under the same capacity and dimensionless cost assumptions. It runs on self-authored toy engines and locally supplied NASA FD001 data.

## Run

Requires Node.js 20 or newer. From this folder:

```text
node --test
node src/maintenance/evaluate.js
node src/maintenance/evaluate.js --fd001
node src/maintenance/evaluate.js --fd001 --seed=17
node scripts/sensitivity.js
```

The toy evaluation writes `outputs/report.json` and `outputs/comparison.csv`; the FD001 evaluation writes `outputs/report-fd001.json` and `outputs/comparison-fd001.csv`. A `--seed=N` run adds `-seedN` to filenames. `--stagger=60` spreads starts over 60 calendar periods; `--unused-life-cost=0.05` changes the discarded-cycle charge; `--compact` omits detailed traces. `scripts/sensitivity.js` reruns the eight start/cost scenarios and writes `outputs/sensitivity-summary.csv`. FD001 requires the extracted files in `data/raw`. `node --check` on source files is a useful syntax check. No build step is required.

## Simulation contract

Each fixture trajectory is one complete life. At local cycle `c`, the policy sees rows `1..c`, including current sensor readings. Requested replacements compete for `slotsPerCycle` in their shared calendar period; higher policy priority wins, then lower engine ID breaks ties. Replacement happens before the end-of-cycle failure event. An unreplaced engine at its last observed cycle fails at the end of that cycle. A replacement or failure ends the life; no post-intervention life is invented. A replacement at the final observed cycle costs the planned amount and avoids failure, with zero unused life. A denied request continues operating and may fail that cycle. Staggered starts shift calendar periods without changing an engine's local age or observed prefix.

Costs are dimensionless: planned replacement is 1 unit, unexpected failure is 2, 5, or 10 units, and discarded observed life costs an assumed 0.01 unit per cycle. The last term makes early replacement costly but is not an observed economic value. No operating cost, inspection, downtime duration, replacement logistics, lost production, or safety impact is modeled. Capacity is 1 or 2 planned jobs per cycle for the toy fleet and 1, 2, or 5 for FD001. Offered slots count each cycle with at least one active engine; utilization is used/offered. Total cost per asset life is the primary metric.

The risk target is whether failure occurs at the end of the current cycle or within the following `h-1` cycles. Features use current cycle, current settings, current sensors, and one-cycle sensor changes. The model is regularized logistic regression; feature means and scales are fitted on training engines only. A Platt slope/intercept is fitted on separate validation engines, and policy thresholds are chosen on the remaining validation engines. The sensor baseline selects one sensor using fitting labels only. Thresholds are frozen for held-out replay. The capacity-aware perfect-knowledge schedule uses true failure cycles and is unattainable in practice.

## Current result

The toy case verifies simulator mechanics. The [publication report](REPORT.md) gives the local FD001 benchmark replay: with failure cost 5, unused-life charge 0.01, and one slot, total simulated cost across 25 held-out lives was 49.77 for fixed interval, 30.57 for sensor threshold, and 28.15 for calibrated risk. These are counterfactual costs under stated assumptions, not measured aircraft or fleet savings. [GUIDE.md](GUIDE.md) explains how to write up or adapt the results.

## NASA data status

See [data access gate](data/README.md). The user supplied an extracted archive locally and confirmed permission to reuse it for this work. The public resource still lists no general license; raw files remain under ignored `data/raw`. `scripts/download-nasa.js` is an optional retry tool.
