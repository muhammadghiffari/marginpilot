# AGENTS.md — MarginPilot (read fully at the start of every session)

## Mission
Build **MarginPilot**: an LLM wallet agent that rescues multiple at-risk lending positions under an owner-signed, on-chain-enforced mandate. FinTechathon 2026, Topic F. Judged on task completion (40), security & compliance (30), innovation & interaction (30), on-chain bonus (0–5). Time is short: ship a complete, verified vertical slice, not a wide unfinished system.

## The design is already approved
Specs live in `docs/spec/` (file-level map: `docs/spec/REPO-MAP.md`), requirements in `docs/prd/PRD.md`, decisions in `docs/DECISIONS.md`. **Do not re-brainstorm the product.** If a skill (e.g. brainstorming) wants to start, treat the approved docs as its output and go to planning for the current task file in `tasks/`. Ask the human only about items marked `OPEN` in DECISIONS.md or genuine spec conflicts. Log new decisions by appending to `docs/DECISIONS.md`.

## Who works where (ownership by folder; avoid editing the other dev's folders)
- **Dev A (infra + chain):** `contracts/`, `deployments/`, `scripts/deploy*`, chain side of `eval/`, `evidence/`. Task file: `tasks/DEV-A.md`.
- **Dev B (core + agent + web):** `packages/`, `apps/`, TS side of `eval/`. Task file: `tasks/DEV-B.md`.
- **Shared:** `docs/`, `STATUS.md`, `tasks/INTEGRATION.md` (small commits, rebase often).
Interfaces between devs are frozen in `docs/spec/INTERFACES.md` and `docs/spec/CONTRACTS.md`. Change them only in a PR that updates both sides and tells the other dev.

## Non-negotiable rules
1. **Never read, print, log, commit or paste secrets.** Do not open `.env`. Use `.env.example` for names. Private keys never go into prompts, logs, audit entries or test fixtures (use anvil's well-known test keys only for local tests).
2. **Never invent facts:** no made-up tx hashes, addresses, benchmark numbers, citations, or test results. Every number in docs comes from a command you ran (`eval/results`, forge/vitest output) or a source marked V-read in `docs/research/EVIDENCE.md`.
3. **The LLM never computes money, prices, health factors or limits, and never touches keys.** Code and chain are the source of truth. The vault is the enforcer.
4. **Fail closed.** Unknown state ⇒ wait or halt, never "try anyway". Unknown tx status ⇒ reconcile, never resend.
5. **Label simulation honestly** (SIMULATED vs REAL). The lending market is a simulator (D-002).
6. **No forbidden claims:** first/unsolved/100% secure/guarantees/rescued real DeFi positions.
7. Do not weaken, skip or delete a failing test to get green. Fix the code or record the gap in `docs/security/KNOWN-RISKS.md`.
8. Mainnet is out of bounds. Only anvil and the configured testnet. Do not run broadcast/deploy commands without the human present (bash permission is `ask`).
9. Scope discipline: P0 first (PRD §5). Do not start P1/P2 until P0 slice is green and demonstrated. FR-20 (defensive learning) and anything "multi-agent" are blocked until D-020 / D-021 are `DECIDED`; do not implement or mention them in UI/docs claims before that.

## Working method (superpowers skills are installed)
For each task in your task file: `writing-plans` (short plan, exact files) → `test-driven-development` (red → green) → implement → `verification-before-completion` (run the commands; show output) → small commit → update `STATUS.md`. Use `requesting-code-review` between major tasks. Use `systematic-debugging` for any failure before changing code. Use git worktrees if the skill asks; `.worktrees/` is gitignored.
If a skill step conflicts with this file or the task file, follow this file and say so in one line.

## Commands (create them in the first scaffold task if missing)
- `scripts/preflight.sh` — tool/env check (never prints secret values)
- `scripts/verify-all.sh` — everything that must be green before a PR/merge
- `scripts/dev-anvil.sh` — local chain on 127.0.0.1:8545, chain id 31337
- Contracts: `cd contracts && forge build && forge test -vv`
- TS: `pnpm install`, `pnpm -r test`, `pnpm -r typecheck`, `pnpm eval:run`
- `scripts/check-secrets.sh` — run before every push
- `scripts/package-submission.sh` — builds `submission-<commit>.zip` from a clean commit and re-scans the zip (human runs it at M5)

`scripts/` is repo tooling that every developer runs in their own clone. It is not a docs generator and is not removed after setup.

## Conventions
TypeScript strict; bigint for money; zod at every boundary; no `any`. Solidity 0.8.24, custom errors with the exact names in CONTRACTS.md, NatSpec on external functions. Conventional commit messages (`feat(contracts): …`). One PR per task id; PR description lists commands run and their results. Keep files small and named as in `docs/spec/ARCHITECTURE.md`.

## Definition of done (per task)
Tests written first and passing; `scripts/verify-all.sh` green; docs/spec updated if behavior changed; `STATUS.md` updated; no secrets (`check-secrets.sh`); acceptance criteria in the task file ticked with evidence (command + output summary).

## When blocked
Write the blocker in `STATUS.md` under "Blockers", pick the next unblocked task, and tell the human. Do not stall silently, do not fake a dependency.
