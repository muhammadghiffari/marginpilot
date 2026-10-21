# SUBMISSION CHECKLIST

Source: official International Track rules file and registration form, captured in **D-026** and **D-028**. Registration and submission deadline: **20 Oct 2026 23:59 Beijing time (= 22:59 WIB)**. Submission and registration mailbox: **fintechathon@ican-x.com**; general contact: **info@ican-x.com**. Demo video is **optional, max 5 minutes**. Submissions may be updated until the deadline; the latest version counts.

## Human-only items
- [ ] Keep the official rules file and registration confirmation with the submission record.
- [ ] Verify the real team composition meets D-027: "at least 60% of a team's members should be non-Chinese nationals."
- [ ] Decide the open items that affect the package: team/brand name is decided (**MarginPilot**, D-035); license (D-013) is still the human's choice.
- [ ] Email organizers about testnet acceptance (`EMAIL-TO-ORGANIZERS.md`), keep the reply.
- [ ] Registration form (Attachment 3) already sent and confirmed.
- [ ] Public URL opens from a phone on mobile data; executor/demo-owner wallets funded; LLM usage cap set.
- [ ] Read every number in the docs against `eval/results/…/summary.md` and explorer pages.
- [ ] Submit the latest package before the deadline, then save the confirmation.

## Package contents (D-028)
- [x] Technical documentation (`TECH-DOC.md`) — architecture, core algorithms, security design
- [ ] Presentation deck — outline exists (`DECK-OUTLINE.md`); final slides max **10 minutes** (TODO(human))
- [ ] Optional demo video — max **5 minutes**
- [x] Source code with README (setup in ≤ 10 commands) + `.env.example` (no secrets)
- [ ] GitHub link — **push blocked from the agent (empty credential cache)**; human must push and confirm judges can access the commit
- [x] Test cases (forge + vitest + eval), local deployment script, and Sepolia deployment receipts; reusable guarded explicit-gas deploy script still TODO (A-10)
- [x] Security self-assessment (`SECURITY-SELF-ASSESSMENT.md`, 329 passing tests)
- [x] Execution evidence (`EXECUTION-EVIDENCE.md`) — SIMULATED market labelled; local-anvil and public Sepolia receipts verified; a browser-driven Sepolia run finished `COMPLETED`; public S2/S7 cases still TODO
- [x] Evaluation summary + `results.json` (Part 1 and Part 2 SIMULATED artifacts)
- [ ] Public link (TODO(human), A-13) + known-risks list (present)
- [x] Demo script (`DEMO-SCRIPT.md`) as supporting material, if recording the optional video — 5-minute script in **English and Bahasa Indonesia**, with the live Sepolia flow, fallbacks, quotable numbers and the claims to avoid

## Gates before submit
- [x] `scripts/verify-all.sh` green (2026-10-21, 329 tests)
- [x] `scripts/check-secrets.sh` clean in the repository; the zip scan is TODO(human) at packaging
- [x] No fabricated hashes: local-anvil and public Sepolia receipts are separated in `evidence/`; in-memory results remain explicitly SIMULATED
- [x] No forbidden claims (see `NOVELTY-AND-PRIOR-ART.md`); no "first"/"unsolved"/"100% secure"/"guarantees" claims
- [ ] Commit hash recorded in docs after the final commit (real-chain code is at `8fcbb0d`; packaging must record the then-current HEAD)
- [ ] The latest version is the one submitted before the deadline (D-026)
