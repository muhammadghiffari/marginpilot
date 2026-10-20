# SUBMISSION CHECKLIST

Rules text (Attachment 2) asks for: technical documentation (architecture, core algorithms, security design), source code, test cases, self-assessment report (permission tiers + known risks), execution evidence (real on-chain tx hashes for Topic F), and a presentation. **Re-read Attachment 2 and the site; this list is derived from our notes.** Deadline, channel, demo video and team rules: see DECISIONS D-014 to D-018.

## Human-only items
- [ ] Confirm deadline clock time (D-014), whether the final submission also needs a portal (D-017), file format limits, and that the demo video is optional (D-015).
- [ ] Decide the open items that affect the package: team/brand name (D-016), license (D-013), team composition wording (D-018).
- [ ] Email organizers about testnet acceptance (`EMAIL-TO-ORGANIZERS.md`), keep the reply.
- [ ] Registration form (Attachment 3) already sent and confirmed.
- [ ] Public URL opens from a phone on mobile data; executor/demo-owner wallets funded; LLM usage cap set.
- [ ] Read every number in the docs against `eval/results/…/summary.md` and explorer pages.
- [ ] Submit, then save the confirmation.

## Package contents
- [ ] Technical documentation (`TECH-DOC-TEMPLATE.md` filled) — PDF/MD as required
- [ ] Security self-assessment (`SECURITY-SELF-ASSESSMENT-TEMPLATE.md` filled with real results)
- [ ] Execution evidence (`EXECUTION-EVIDENCE-TEMPLATE.md`) — real tx hashes + explorer links, simulated parts labelled
- [ ] Evaluation summary + `results.json`
- [ ] Source code + README (setup in ≤ 10 commands) + `.env.example` (no secrets)
- [ ] Test cases/outputs (forge + vitest + eval)
- [ ] Presentation / demo script (`DEMO-SCRIPT.md`), optional video
- [ ] Public link + known-risks list

## Gates before submit
- [ ] `scripts/verify-all.sh` green on a clean clone
- [ ] `scripts/check-secrets.sh` clean (also scan the zip)
- [ ] No fabricated hashes: every hash resolves on the explorer
- [ ] No forbidden claims (see `NOVELTY-AND-PRIOR-ART.md`)
- [ ] Commit hash recorded in docs
