# STARTER PROMPTS (paste into opencode; superpowers installed)

## Dev A — first session
```
Read AGENTS.md, STATUS.md, docs/DECISIONS.md, docs/prd/PRD.md (sections 5-6), docs/spec/REPO-MAP.md, docs/spec/CONTRACTS.md and tasks/DEV-A.md.
The design is already approved: skip brainstorming and do not redesign. 
Start with task A-01: use writing-plans to produce a short plan, then test-driven-development.
Initialize the Foundry project inside contracts/: the directory is not empty, so `forge init` needs `--force` (and `--no-git`, the repo root already is a git repo). contracts/foundry.toml must stay as committed: after init run `git diff contracts/foundry.toml` and restore it with `git checkout -- contracts/foundry.toml` if it changed; delete the template Counter files. Then install forge-std (`forge install foundry-rs/forge-std`; if it complains about git state, read its message and fix the cause, do not work around it) and keep all error names exactly as in CONTRACTS.md.
Never read .env. When A-01 is done, run scripts/verify-all.sh, show the output, update STATUS.md, commit, and continue with A-02.
```

## Dev B — first session
```
Read AGENTS.md, STATUS.md, docs/DECISIONS.md, docs/prd/PRD.md (sections 5-6), docs/spec/REPO-MAP.md, docs/spec/INTERFACES.md, docs/spec/OPTIMIZER.md and tasks/DEV-B.md.
The design is already approved: skip brainstorming and do not redesign.
Start with B-01 then B-02..B-06 using writing-plans and test-driven-development. 
Pin numbers from docs/spec/OPTIMIZER.md §6 and verify them against `python3 eval/worked_example.py`.
Never read .env. Run scripts/verify-all.sh after each task, update STATUS.md, commit.
```

## Continue (every later session, either dev)
```
Read AGENTS.md, STATUS.md and docs/DECISIONS.md, then your task file (tasks/DEV-A.md or tasks/DEV-B.md).
Take the first task in your file whose state in STATUS.md is todo and whose Needs are done; if none is unblocked, write the blocker in STATUS.md and tell me.
Same method as before: plan, tests first, implement, scripts/verify-all.sh, update STATUS.md, commit. Do not redesign; spec changes go through a PR that edits the spec first.
```

## Review / debug prompts
```
Use requesting-code-review on the diff of this branch against docs/spec/*.md; list spec deviations by severity.
```
```
Use systematic-debugging: reproduce the failing test, state the root cause with evidence, then fix. Do not change tests to pass.
```

## Docs fill (late stage)
```
Using only eval/results/<latest>/summary.md, forge/vitest outputs and evidence/*, fill docs/submission/*-TEMPLATE.md. 
Do not invent numbers or hashes. Mark anything unverified as TODO for the human.
```

## Sanity check that superpowers loaded
In a fresh session ask: "List the skills you have available and which one you will use first for task A-01." Expect writing-plans/test-driven-development to be named. If not, see docs/02-DEV-WORKFLOW.md.
