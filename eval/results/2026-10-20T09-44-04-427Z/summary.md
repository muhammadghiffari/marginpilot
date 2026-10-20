# Part 1 — allocation quality (SIMULATED)

Commit: `4c4da28a4cc7a9c522905f2eacfbcf6cf42d8c66`. Seed range: 1–500 (500 cases).
Two independent simulated pools per case. No chain transactions and no LLM; A is the local HF<1.05 threshold rule, B is the exhaustive optimizer.
Each case shares one Bernoulli stress realization across A and B (stress drop 10%, probability 50%). All money metrics below are USD.

| Metric | A mean / median / p90 | B mean / median / p90 |
|---|---:|---:|
| expectedLossUsd | 118.0107 / 84.0291 / 274.9051 | 103.2832 / 70.3459 / 249.2791 |
| realizedLossUsd | 90.3839 / 80.6432 / 201.8006 | 76.4605 / 68.6981 / 183.6662 |
| spentUsd | 132.9882 / 127.0000 / 271.0000 | 77.5270 / 56.5300 / 214.9600 |
| safePools | 1.4120 / 2.0000 / 2.0000 | 1.5100 / 2.0000 / 2.0000 |

Win / tie / loss (B vs A, realized loss): 118 / 158 / 224.
Mean difference B − A (realized USD): -13.9234; bootstrap 95% CI [-17.6227, -10.3966].
Win / tie / loss (B vs A, model expected loss): 203 / 50 / 247.
Mean difference B − A (expected USD): -14.7275; bootstrap 95% CI [-17.7052, -11.8094].

Limitations: simulated market; constructed two-pool generator (core position type currently limits poolId to 0|1); the loss model mirrors the optimizer; independent threshold A is intentionally simple; single-step liquidation with no interest or execution costs. B searches discrete repay levels, while A may choose a partial-target amount outside that set: B can lose individual cases even on model expected loss. Any mean advantage is model-relative, not evidence of real-market performance.
