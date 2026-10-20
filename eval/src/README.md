# eval/src

**Purpose:** Evaluation harness: Part 1 simulation, Part 2 runner (configs A-D), Part 3 (NL compile, explanation rubric, injection), repeated-run study (k=5), report writer.
**Owner:** Dev B (Dev A supports the chain side)
**Tasks:** B-12, B-14, B-16; B-15 (differential test, FR-16)
**Spec:** `docs/eval/EVALUATION-PLAN.md`, `docs/spec/ARCHITECTURE.md` (config table A-D).

Part 1 is implemented in `part1-simulation.ts`, `report.ts`, and `cli.ts`. Run `pnpm eval:run -- --part 1 --seed 1` from the repository root to generate 500 deterministic SIMULATED cases and `eval/results/<timestamp>/{results.json,summary.md,run-meta.json}`. Only `summary.md` is tracked; the raw cases and provenance are generated locally and included by the submission packager.

Part 2 (`--part 2` or `--part all`) deliberately fails closed until Dev A's A-07 deployment/ABI/base fixture and A-09 chain runner are available. Do not present Part 1 as anvil or real testnet evidence.
