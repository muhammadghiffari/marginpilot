# evidence/

Generated artifacts only. Layout (suggested):
- `tx-hashes.json` — written by scripts from real receipts (never typed by hand)
- `screenshots/`, `recordings/`
- `audit.jsonl` — runtime audit log (gitignored; export a redacted copy for submission)
Label each item REAL (testnet) or SIMULATED (anvil). See `docs/submission/EXECUTION-EVIDENCE-TEMPLATE.md`.

## Generated evidence (post-submission, 2026-10-28)

`evidence/manifests/<name>.json` lists transaction hashes (taken from the agent API or imported from older
evidence files). `evidence/receipts/<name>.json` is produced by `pnpm --filter @marginpilot/agent evidence generate --rpc <url>`,
which re-reads every receipt from the chain; `docs/submission/EXECUTION-EVIDENCE.md` is rendered from those files.
Older hand-assembled files (`sepolia-*.json`) are kept for the record and are superseded by the generated ones.
Use an RPC that is in sync (a load-balanced public node can return "receipt not found" for an old hash; retry with another).
