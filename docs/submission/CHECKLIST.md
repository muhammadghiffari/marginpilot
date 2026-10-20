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
- [ ] Technical documentation (`TECH-DOC-TEMPLATE.md` filled) — architecture, core algorithms, security design
- [ ] Presentation deck — final presentation max **10 minutes**
- [ ] Optional demo video — max **5 minutes**
- [ ] Source code with README (setup in ≤ 10 commands) + `.env.example` (no secrets)
- [ ] GitHub link — repository/commit or tag that judges can access
- [ ] Deployment instructions and test cases (forge + vitest + eval)
- [ ] Security self-assessment (`SECURITY-SELF-ASSESSMENT-TEMPLATE.md` filled with real results)
- [ ] Execution evidence (`EXECUTION-EVIDENCE-TEMPLATE.md`) — real on-chain tx hashes for Topic F + explorer links, simulated parts labelled
- [ ] Evaluation summary + `results.json`
- [ ] Public link + known-risks list
- [ ] Demo script (`DEMO-SCRIPT.md`) as supporting material, if recording the optional video

## Gates before submit
- [ ] `scripts/verify-all.sh` green on a clean clone
- [ ] `scripts/check-secrets.sh` clean (also scan the zip)
- [ ] No fabricated hashes: every hash resolves on the explorer
- [ ] No forbidden claims (see `NOVELTY-AND-PRIOR-ART.md`)
- [ ] Commit hash recorded in docs
- [ ] The latest version is the one submitted before the deadline (D-026)
