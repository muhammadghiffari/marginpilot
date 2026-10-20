# eval/src

**Purpose:** Evaluation harness: Part 1 simulation, Part 2 runner (configs A-D), Part 3 (NL compile, explanation rubric, injection), repeated-run study (k=5), report writer.
**Owner:** Dev B (Dev A supports the chain side)
**Tasks:** B-12, B-14, B-16; B-15 (differential test, FR-16)
**Spec:** `docs/eval/EVALUATION-PLAN.md`, `docs/spec/ARCHITECTURE.md` (config table A-D).

Entry point target: `pnpm eval:run -- --part all --seed 1`. Empty on purpose. See `docs/spec/REPO-MAP.md`.
