# Maintenance Decision Lab: FD001 policy replay

**Study type:** retrospective simulation on synthetic run-to-failure trajectories  
**Data:** [NASA CMAPSS Jet Engine Simulated Data](https://data.nasa.gov/dataset/cmapss-jet-engine-simulated-data), FD001  
**Primary outcome:** simulated dimensionless cost per engine life

## Summary

At one planned-maintenance slot per period, failure cost 5, replacement cost 1, and discarded-life charge 0.01 per cycle, calibrated risk produced total simulated cost **28.15** across 25 held-out complete lives (1.126 per life), compared with **30.57** for the sensor threshold (1.223 per life) and **49.77** for the fixed interval (1.991 per life). Risk and sensor rules both replaced all 25 lives; risk discarded fewer recorded cycles. This result depends on the chosen counterfactual costs and is **not** a measured fleet saving.

## Data and evaluation design

The locally supplied CMAPSS archive has 100 complete FD001 training engine lives. Seed 23 splits them by engine: 50 for fitting, 12 for risk calibration, 13 for policy tuning, and 25 for held-out replay. The official 100 truncated FD001 test engines are used only for a last-snapshot prediction check. Full IDs, selected thresholds, per-engine outcomes, and default action traces are in [report-fd001.json](outputs/report-fd001.json). The [NASA dataset description](https://data.nasa.gov/dataset/cmapss-jet-engine-simulated-data) documents the distinction between complete training and truncated test trajectories.

## Simulation contract and costs

Each engine contributes one life. At local cycle `c`, a policy sees only rows through `c`. Planned replacements compete for slots in the shared **calendar period**; an unreplaced engine fails at the end of its final observed cycle. Replacement or failure exits that life. For staggered starts, local age still begins at one, while calendar periods are offset. The 25 held-out start periods span 3–60, with 23 distinct start periods, in the 60-period scenario. Offsets are a deterministic function of engine ID and split seed; they do not use failure time or sensor values.

All costs are **assumed dimensionless units**: planned replacement 1; unexpected failure 2, 5, or 10; discarded observed life 0, 0.01, 0.05, or 0.1 per cycle. The last term is a hypothetical opportunity charge, not a measured NASA cost. No second life, actual intervention effect, downtime duration, real labor cost, or aircraft safety outcome is modeled. All policies use identical costs and slot limits within each scenario.

Fixed-interval, sensor-11 threshold, and calibrated horizon-risk rules are tuned on the 13 policy-tuning engines for each cost and capacity setting. Sensor 11 is selected using fitting engines only. The risk model uses local cycle, current settings, current sensors, and one-cycle sensor changes. The target is failure at the end of the current or next 14 cycles. Feature scaling is fitted on 50 engines; a Platt slope and intercept are fitted on the separate 12 calibration engines. The perfect-knowledge schedule uses true failure cycles and is an unattainable reference.

## Held-out policy cost

Default unused-life charge is 0.01. These are total simulated costs across **25 held-out complete lives**; divide by 25 for cost per life.

| Slots/cycle | Failure cost | Fixed interval | Sensor threshold | Calibrated risk | Perfect knowledge |
|---:|---:|---:|---:|---:|---:|
| 1 | 2 | 45.64 | 30.57 | 28.15 | 25.01 |
| 1 | 5 | 49.77 | 30.57 | 28.15 | 25.01 |
| 1 | 10 | 54.77 | 30.57 | 28.15 | 25.01 |
| 2 | 2 | 45.78 | 30.68 | 28.18 | 25.00 |
| 2 | 5 | 56.98 | 30.68 | 28.18 | 25.00 |
| 2 | 10 | 71.98 | 30.68 | 28.18 | 25.00 |
| 5 | 2 | 44.30 | 30.68 | 28.18 | 25.00 |
| 5 | 5 | 49.74 | 30.68 | 28.18 | 25.00 |
| 5 | 10 | 54.74 | 30.68 | 28.18 | 25.00 |

At one slot, failure cost 5, and unused-life charge 0.01, the fixed rule replaces 24, fails 1, and discards 2,077 observed cycles. The sensor and risk rules replace all 25, discarding 557 and 315 cycles respectively. The full cost breakdown is in `outputs/comparison-fd001.csv`.

Two additional engine-level splits at the same one-slot, 5-cost setting give:

| Split seed | Fixed interval | Sensor threshold | Calibrated risk | Perfect knowledge |
|---:|---:|---:|---:|---:|
| 17 | 43.34 | 30.33 | 28.58 | 25.06 |
| 41 | 47.02 | 30.23 | 27.85 | 25.07 |

## Staggered starts and unused-life charge

With one slot and failure cost 5, the sensitivity grid is:

| Start pattern | Discarded-cycle charge | Fixed interval | Sensor threshold | Calibrated risk | Perfect knowledge |
|---|---:|---:|---:|---:|---:|
| Simultaneous | 0 | 29.00 | 25.00 | 25.00 | 25.00 |
| Simultaneous | 0.01 | 49.77 | 30.57 | 28.15 | 25.01 |
| Simultaneous | 0.05 | 124.20 | 52.85 | 40.75 | 25.05 |
| Simultaneous | 0.1 | 130.20 | 80.70 | 56.50 | 25.10 |
| Spread over 60 periods | 0 | 29.00 | 25.00 | 25.00 | 25.00 |
| Spread over 60 periods | 0.01 | 50.16 | 30.60 | 28.15 | 25.02 |
| Spread over 60 periods | 0.05 | 107.20 | 53.00 | 40.75 | 25.10 |
| Spread over 60 periods | 0.1 | 158.50 | 81.00 | 56.50 | 25.20 |

The learned-risk and sensor rules tie when discarded life has zero cost because both replace all 25 held-out lives. The risk rule discards fewer cycles and therefore costs less when that charge is positive. Changing starts alters contention and the fixed rule's selected interval and outcomes. The full 1/2/5-slot and 2/5/10-failure-cost grid for every start/cost combination is in `outputs/sensitivity-summary.csv`.

The detailed 60-period, 0.01-charge action trace is in [report-fd001-stagger60-unused0.01.json](outputs/report-fd001-stagger60-unused0.01.json) under `traces`. Each action records both the engine's local cycle and shared calendar period.

## Calibration, separately from decisions

On held-out complete trajectories, Brier score improves from **0.0222 raw to 0.0159 calibrated** across 5,368 cycle snapshots. Early-life Brier improves from 0.00020 to approximately 0; late-life Brier improves from 0.0440 to 0.0318. In calibrated low/middle/high bins, average predictions are 0.0087/0.488/0.909 and observed event rates are 0.0053/0.436/0.857. Calibration still has error, particularly late in life.

The official **truncated** test set has one last snapshot per engine: Brier improves from 0.0323 raw to 0.0163 calibrated across 100 engines, nine positive within-15-cycle labels. This is prediction only; the truncated paths cannot support complete-life replay. Held-out complete-life Brier also improves with split seeds 17 (0.0212 to 0.0157) and 41 (0.0194 to 0.0113).

## Interpretation

These are counterfactual outcomes under synthetic FD001 trajectories and chosen costs, not measured maintenance savings. Staggered starts and the unused-life charge were tested, but neither establishes a real deployment benefit. The user has confirmed permission to reuse the NASA data for this work; the archive readme and public resource page do not state a general redistribution license. Raw files remain in `data/raw`, outside derived reports.

## Reproducibility and source

Run `node --test`, `node src/maintenance/evaluate.js --fd001`, and `node scripts/sensitivity.js` from the project folder. The [comparison table](outputs/comparison-fd001.csv) and [sensitivity summary](outputs/sensitivity-summary.csv) are the machine-readable companions to this writeup. The user-supplied ZIP has SHA-256 `74BEF434A34DB25C7BF72E668EA4CD52AFE5F2CF8E44367C55A82BFD91A5A34F`; `data/README.md` records the local integrity and schema checks. The [NASA resource page](https://data.nasa.gov/dataset/cmapss-jet-engine-simulated-data/resource/5224bcd1-ad61-490b-93b9-2817288accb8) currently lists no general license.

## Timing, denominators and uncertainty

Replacement may occur after the current sensor reading and before failure at the end of that cycle, including the true final cycle. There is no intervention lead time or repair-duration model, and unexpected failures do not consume a planned slot. Discarded life uses the known terminal cycle retrospectively for accounting, not as a deployable observation.

Offered slots count only periods with active decision records. The denominator changes with each policy termination time, so utilization percentages are descriptive and are not directly comparable fixed-horizon capacity efficiencies.

The 5,368 snapshots are repeated observations within 25 held-out engines, not 5,368 independent units. Brier is averaged over cycles, giving longer lives more weight. No engine-level confidence interval is reported. Additional split seeds are sensitivity checks on the same pool.

## Input evidence

Historical evidence status before the 3 November 2026 reproduction: source code, saved model metadata, split IDs, per-engine outcomes and action traces are published. Raw FD001 files were supplied locally and are not bundled. The documented archive hash identifies recorded local inputs and extraction integrity, not an independent match to a NASA checksum. That earlier correction did not include a fresh model reproduction. The documented 3 November 2026 reproduction below supersedes this reproduction status; the baseline FD001 replay, separate operational sensitivity simulator and companion browser toy remain distinct. Costs are dimensionless, not measured fleet savings or aircraft safety validation.


## Independent reproduction and operational sensitivity, 3 November 2026

Reacquired the official NASA archive via the documented CKAN resource and extracted only FD001 locally. `outputs/retrieval-manifest.json` records original archive and input hashes. Refit training standardisation and logistic model, recalibrated on separate validation engines, retuned policies, then replayed held-out engines. All four default costs match the previously published run within 1e-8: fixed 49.77, sensor 30.57, risk 28.15 and unattainable oracle 25.01. The raw files remain ignored.

A paired engine-outcome bootstrap uses 10,000 draws, seed 20261103. Risk-minus-sensor mean cost difference is -0.0968 per engine, with descriptive percentile interval [-0.1300, -0.0640]. This resamples 25 engine outcomes rather than cycle snapshots. It conditions on the fitted policies and realised capacity allocation; it does not rerun shared-capacity interactions and therefore has no coverage guarantee for a new fleet. It excludes model-refitting uncertainty. Separate seeds 17 and 47 refit, recalibrate and retune on different engine partitions; those are split sensitivities, not confidence intervals or independent new datasets.

`src/maintenance/operational.js` adds a separate operational simulator with persistent requests, frozen request priority, intervention lead time, multi-period bay occupancy, staggered arrivals and optional shared capacity for failure repairs. Failures enter the service queue in the following period. For each scenario all policies use the same natural-life calendar horizon, including idle periods. Repairs beyond that horizon are censored. Jobs already in progress hold their bay; queued failure work has priority over planned jobs at allocation. The model does not invent a second engine life or account for post-intervention production.

Twenty-four scenarios cross lead times 0/3/7 periods, durations 1/3, stagger 0/60 and shared failure capacity off/on, using the frozen default policies. The risk policy remains lowest cost in this bounded grid. This does not guarantee preference under all assumptions. Policy thresholds are not retuned to each operational scenario. `outputs/operational-validation.json` includes cost, failures, common-horizon offered slots, occupied slot-periods, unfinished failure repairs and per-engine outcomes.

Reproduce with `node scripts/download-nasa.js`, extract FD001 as documented, `node src/maintenance/evaluate.js --fd001`, `node src/maintenance/evaluate.js --fd001 --seed=17 --compact` (repeat for seed 47), then `node scripts/validate-operations.js`. Run `node --test` for simulator checks. Node version, source hashes and output hash are in `outputs/operational-manifest.json`. No build is needed.

The browser's constructed replay remains the original immediate-action teaching scenario. It does not display the extended operational scenarios or bundle NASA data. No real fleet savings or safety gains are measured.
