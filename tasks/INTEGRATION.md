# INTEGRATION — sync points and shared tasks

| Point | When | What | Who |
|---|---|---|---|
| I-1 | when A-01..A-04 compile and B-02 types exist | freeze ErrorName/struct layouts; Dev A exports ABIs to `packages/core/src/abi/`; Dev B regenerates types | both |
| I-2 | A-07 + B-08 | local deploy on anvil → `deployments/31337.json` → `ViemChainPort` reads real state | both |
| I-3 | A-08 | cross-language EIP-712 signature test | both (pair) |
| I-4 | M2 | run S1 + S7 end-to-end on anvil, fix mismatches | both |
| I-5 | M3 | testnet deploy and real runs, evidence capture; **freeze features** after | both |
| I-6 | M4 | docs fill from real results; human sanity pass | both + owner |

Conflict protocol: if an implementation needs a spec change, open a PR that edits the spec first, ping the other dev, then implement. Rebase daily/after each merge; never force-push `main`.

## Requirement coverage (every FR in `docs/prd/PRD.md` §6 and the task that delivers it)
| FR | Pri | Delivered by |
|---|---|---|
| FR-01 NL → mandate draft | P0 | B-07 |
| FR-02 owner signs, vault accepts only owner | P0 | A-04, A-08 (cross-language), B-11 (UI) |
| FR-03 observe from chain | P0 | B-08, B-09 |
| FR-04 deterministic planner | P0 | B-04 |
| FR-05 explanations | P0 (grounding P1) | B-09 (template), B-13 (paraphrase + grounding) |
| FR-06 execute only via vault | P0 | A-04, A-05, B-08 |
| FR-07 verify, ledger, report | P0 | B-06, B-09 |
| FR-08 replan with remaining budget | P0 | B-09 (S3) |
| FR-09 safe halt | P0 | B-09 (S2/S5) |
| FR-10 kill switch, owner withdraw | P0 | A-04, B-09, B-10 (S9) |
| FR-11 hash-chained audit log | P0 | B-06 |
| FR-12 scenario lab | P0 | A-09 (chain side), B-10 (`/api/demo/*`), B-11 (UI) |
| FR-13 dashboard | P0 | B-11 |
| FR-14 eval harness | P0 (Part 3 P1) | B-12, B-14 |
| FR-15 session memory | P1 | B-14 |
| FR-16 differential test | P1 | A-12, B-15 |
| FR-17 public deployment, rate limits | P0 | B-10, A-13 |
| FR-18 MCP read tools | P2 | B-17 |
| FR-19 per-action co-signature | P2 | no task (not planned) |
| FR-20 defensive learning | P1, blocked | no task until D-020 is DECIDED |
