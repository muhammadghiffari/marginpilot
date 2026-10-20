# MarginPilot — paket handover FinTechathon 2026 (Topic F)

Mandate-bound autonomous wallet untuk rescue beberapa posisi pinjaman DeFi. Paket ini berisi PRD, spesifikasi, instruksi agent (AGENTS.md), backlog per developer, tooling (`scripts/`), dan template submission.

**Mulai di sini → [docs/00-START-HERE.md](docs/00-START-HERE.md)**

| Kamu | Baca urutan ini |
|---|---|
| Owner/infra (Ghiffari) | 00-START-HERE → 01-SETUP-INFRA → 04-MANUAL-VS-AUTO → 03-TIMELINE |
| Dev B (teman, mulai langsung) | 00-START-HERE → 02-DEV-WORKFLOW → `tasks/DEV-B.md` |
| Agent (opencode) | `AGENTS.md` lalu file task masing-masing |

Peta folder
```
AGENTS.md  STATUS.md  opencode.json  .env.example
docs/      00..04 runbook (ID) · prd/ · spec/ · security/ · eval/ · research/ · submission/ · DECISIONS.md
tasks/     DEV-A.md DEV-B.md INTEGRATION.md PROMPTS.md
scripts/   preflight.sh verify-all.sh check-secrets.sh dev-anvil.sh package-submission.sh
contracts/ packages/ apps/ eval/ deployments/ evidence/   (diisi oleh agent)
```

**Tentang `scripts/`:** ini tooling repo yang dijalankan tiap developer di klon masing-masing (cek mesin, gerbang hijau sebelum PR, scan secret, chain lokal, paket submission). Bukan generator dokumen dan bukan skrip sekali pakai; `AGENTS.md` dan `opencode.json` bergantung padanya. Skrip deploy (`scripts/deploy.sh`) dibuat nanti di tugas A-07.

Mulai cepat (di WSL `~/`, bukan `/mnt/c`):
```bash
cd ~/marginpilot && git init -b main && git add -A && git commit -m "chore: handover package"
scripts/preflight.sh --role dev-b      # atau --role dev-a
scripts/verify-all.sh                  # harus VERIFY-ALL: GREEN
```

Catatan jujur: paket ini berisi **desain, spesifikasi, dan tooling**. Kode produk (kontrak, agent, UI) belum ada; itu dikerjakan agent mengikuti `tasks/`. Keputusan yang masih terbuka (lisensi, nama tim, model LLM, aturan tim, "defensive learning", "multi-agent") ada di `docs/DECISIONS.md`.
