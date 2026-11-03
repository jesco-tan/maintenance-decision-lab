# Validation

I reacquired the official FD001 inputs and reran fitting, calibration, policy tuning and held-out replay. The default costs reproduced the saved results. All 14 Node tests passed.

I also refitted using split seeds 17 and 47 and evaluated 24 operational scenarios covering intervention lead time, repair duration, staggered arrivals and shared failure-repair capacity. The operational results use a common calendar denominator within each scenario.

## Scope

The engine-outcome bootstrap conditions on the fitted policies and realised replay outcomes. It does not rerun capacity-coupled fleet interactions or provide a coverage guarantee for a new fleet. Alternative split refits are separate sensitivity checks. The browser toy, FD001 evaluation and operational scenarios remain distinct; no measured fleet saving or safety gain is established. See [REPORT.md](REPORT.md), `outputs/operational-validation.json` and `outputs/operational-manifest.json` for details and reproduction.
