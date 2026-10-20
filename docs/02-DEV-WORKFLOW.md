# 02 — DEV WORKFLOW (dua developer + opencode + superpowers)

## Alur per tugas (dipaksa AGENTS.md)
`writing-plans` → `test-driven-development` (merah→hijau) → implementasi → `verification-before-completion` (jalankan `scripts/verify-all.sh`, lihat output) → commit kecil → update `STATUS.md`. `requesting-code-review` di antara tugas besar; `systematic-debugging` untuk setiap kegagalan.

Skill `brainstorming` akan mencoba aktif otomatis. Desain **sudah disetujui**, jadi prompt awal menyuruhnya dilewati. Jika agent tetap mulai brainstorming panjang, ketik: "Design is approved in docs/. Skip brainstorming; go to writing-plans for task <id>."

## Git
- `main` selalu hijau. Branch pendek per tugas: `a/A-04-vault`, `b/B-04-optimizer`. PR kecil, deskripsi memuat perintah yang dijalankan + hasilnya.
- Folder milik masing-masing (lihat `AGENTS.md`). File bersama (`docs/`, `STATUS.md`) → commit kecil + `git pull --rebase`.
- Jangan force-push. Jangan commit `.env`. Jalankan `scripts/check-secrets.sh` sebelum push.
- Git worktree (dipakai superpowers) masuk `.worktrees/` yang sudah di-gitignore.

## Titik sinkron (tasks/INTEGRATION.md)
I-1 bekukan struct/ErrorName + ABI · I-2 deploy lokal & `ViemChainPort` · I-3 tes EIP-712 lintas bahasa (pairing) · I-4 S1+S7 end-to-end · I-5 testnet lalu **freeze fitur** · I-6 isi dokumen.

## Komunikasi spesifikasi
Butuh ubah spec? PR yang mengubah spec dulu, kabari rekan, baru implementasi. Keputusan baru → tambah baris di `docs/DECISIONS.md`.

## Folder `scripts/` (kenapa ada, kapan dijalankan)
Ini tooling repo yang dijalankan tiap developer di klon masing-masing, bukan skrip pembuat dokumen dan bukan sekali pakai. `preflight.sh` cek mesin dan `.env`; `verify-all.sh` gerbang hijau sebelum PR; `check-secrets.sh` sebelum push; `dev-anvil.sh` chain lokal; `package-submission.sh` membuat zip submission (manusia, M5). `AGENTS.md` dan `opencode.json` merujuk ke skrip-skrip ini, jadi jangan dihapus.

## Menjalankan lokal
```bash
scripts/dev-anvil.sh            # terminal 1
cd contracts && forge test -vv  # Dev A
pnpm -r test                    # Dev B
scripts/verify-all.sh           # semua, sebelum PR
```

## Catatan permission opencode (`opencode.json`)
- **Urutan aturan:** dokumentasi opencode (https://opencode.ai/docs/permissions) menyatakan aturan dievaluasi per pola dan *last matching rule wins*; pola catch-all ditaruh paling awal. Karena itu `scripts/deploy*` = `ask` sengaja ditaruh **setelah** `scripts/*` = `allow`. Jangan pindahkan ke atasnya, nanti kalah dan deploy lolos tanpa persetujuan (AGENTS.md aturan 8).
- **Sudah dicek** pada halaman resmi https://opencode.ai/docs/permissions (2026-10-20): *last matching rule wins*, dan bentuk objek-dengan-pola didukung untuk `read`, `edit`, `bash`.
- **Belum diverifikasi:** (a) bahwa versi opencode yang terpasang di mesin kalian mempertahankan urutan kunci JSON saat memuat `opencode.json` (dokumen V2 memakai format array `permissions`, repo ini memakai format objek `permission`); (b) perilaku nyata pada `scripts/deploy.sh`, karena filenya baru dibuat di A-07. Uji manual setelah A-07: minta agent menjalankan `bash scripts/deploy.sh`; harus muncul prompt persetujuan. Jika tidak muncul, anggap aturan tidak berlaku dan jangan menjalankan deploy lewat agent.
- **Cakupan sempit:** pola hanya mencocokkan perintah yang diawali `scripts/deploy` atau `bash scripts/deploy`. Bentuk lain (`./scripts/deploy.sh`, `cd scripts && ...`) jatuh ke `"*": "ask"`, tetapi `node *` dan `python3 *` = `allow` dapat menjalankan kode apa pun. Ini bukan sandbox.
- **`deny` baca `.env` hanya berlaku di opencode.** Agent/tool lain yang dibuka di repo ini (editor AI, CLI agent lain) tidak membaca `opencode.json`. Sebelum dipakai, pasang pengaman setara di tool tersebut (aturan deny/ignore baca `.env` dan `.secrets/`, persetujuan untuk perintah deploy/broadcast). Cara konfigurasinya per tool belum diverifikasi: cek dokumentasi masing-masing. Pengaman tambahan yang tidak bergantung tool: pakai key testnet khusus berbatas dana, dan jangan taruh `.env` bernilai nyata di folder yang dibuka agent lain.

## Troubleshooting
- Skill tidak muncul → restart opencode; ikuti README.opencode.md di repo superpowers; sesi baru.
- Agent membaca `.env` / diblok permission → memang diblok; pakai `.env.example` untuk nama variabel.
- Perintah `ask` muncul terus → setujui hanya yang kamu pahami.
- LLM mahal/lambat → pakai `ScriptedLlm` di tes; live hanya untuk demo & eval Part 3.
- Faucet kosong → pakai faucet lain, kurangi jumlah deploy ulang; uji dulu di anvil.
