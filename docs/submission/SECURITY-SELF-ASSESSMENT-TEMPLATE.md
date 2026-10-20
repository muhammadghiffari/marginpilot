# Security Self-Assessment — MarginPilot
Commit: <hash> · Run date: <date> · Chain: <network>

1. **Scope & trust zones** — from `THREAT-MODEL.md`.
2. **Permission tiers** — L0–L3 table from `PERMISSION-TIERS.md`, and where each is enforced in code (file:line).
3. **Controls implemented** — session/executor key separation, EIP-712 mandate, cumulative budget, locks, freshness, deviation, slippage, post-conditions, pause, owner withdraw, redaction, rate limits. For each: file reference + test id.
4. **Test results** — table T01–T18: `status (pass/fail/not run)`, layer, evidence link. Totals: `tests_total=<n> passed=<n> scenarios=<n> runs_per_scenario=<k>`.
5. **Failures found and fixed** (this is a strength; list them).
6. **Known risks** — paste `KNOWN-RISKS.md`.
7. **Not covered** — explicit list.
Wording rule: "no violations were found in the N reported scenarios", never "proven secure".
