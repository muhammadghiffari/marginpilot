# 01 — SETUP INFRA (Owner mengerjakan; target: teman bisa langsung start)

Legenda: **[M]** manual manusia · **[A]** bisa diserahkan ke agent. Perintah yang belum saya uji di mesin kalian ditandai (cek) — jika error, baca pesan dan docs resminya.

## A0. Kewajiban WSL (pengguna Windows) — [M]
Semua pekerjaan repo dilakukan **di dalam WSL, di home Linux (`~/`)**, bukan di `/mnt/c/...`:
- Ekstrak zip, clone, `pnpm`, `forge`, `anvil`, dan opencode dijalankan dari terminal WSL. Lokasi yang dipakai: `~/marginpilot`.
- Alasan (umum, belum diuji di mesin kalian): bit executable skrip `scripts/*.sh` dan akhir baris LF bisa rusak di folder Windows, dan I/O di `/mnt/c` jauh lebih lambat untuk `node_modules` dan build Foundry.
- Pasang Node, pnpm, Foundry, jq, python3, zip **di dalam WSL**, bukan di sisi Windows. Cek `pwd` harus berawalan `/home/<user>/`.
- macOS/Linux asli: abaikan bagian ini.

## A. Repo & akses (≈15 menit) — [M]
1. Buat repo **kosong** `marginpilot` di GitHub dan tambah teman sebagai collaborator (visibilitas: lihat D-019 / D-013). Panduan repo kosong:
   - Saat membuat repo, **jangan centang** "Add a README", "Add .gitignore", maupun "Choose a license". Repo tanpa commit membuat push pertama bersih; `.gitignore` dan `LICENSE` sudah ada di paket ini.
   - Jika repo terlanjur berisi commit awal dari GitHub: **jangan force-push**. Jalankan `git pull --rebase origin main --allow-unrelated-histories`, selesaikan konflik (pertahankan `LICENSE`/`.gitignore` dari paket ini), lalu push biasa.
   - Jangan membuat branch lain sebelum push pertama selesai.
2. Pastikan identitas git terisi (sekali saja): `git config --global user.name "<nama>"` dan `git config --global user.email "<email>"`. Ekstrak zip ini **di `~/` (WSL)**, lalu:
   ```bash
   cd ~/marginpilot && git init -b main && git add -A && git commit -m "chore: handover package"
   git remote add origin <url-repo> && git push -u origin main
   ```
3. (Disarankan) branch protection `main`: wajib PR. Jika waktu mepet, boleh push langsung tapi **rebase sebelum push**, jangan force-push.
4. Teman: `git clone` **ke `~/` di WSL**, lalu `cd ~/marginpilot`.
5. Di **kedua mesin**, setelah clone:
   ```bash
   git submodule update --init --recursive   # bila ada submodule (mis. dependency Foundry di contracts/lib); aman dijalankan walau tidak ada
   ls -l scripts/*.sh                        # semua harus berbit executable (-rwx...)
   git update-index --chmod=+x scripts/*.sh  # hanya bila bit executable hilang (mis. zip lewat Windows), lalu commit
   ```
<!--  -->
## B. Toolchain di KEDUA mesin (≈30 menit) — [M]
| Tool | Perintah | Cek |
|---|---|---|
| Node 22 | `nvm install 22 && nvm use 22` | `node -v` ≥ 22 | <!-- kalau udh di atas 22 gausah ya -->
| pnpm | `corepack enable && corepack prepare pnpm@latest --activate` (cek) | `pnpm -v` |
| Foundry | `curl -L https://foundry.paradigm.xyz \| bash` lalu `foundryup` | `forge --version`, `anvil --version`, `cast --version` |
| jq, python3, git | paket manager OS | `jq --version` |
| opencode | sudah terpasang | `opencode --version` |
Dev B boleh menunda Foundry; Dev A wajib.
**Superpowers di opencode** (sudah terpasang): verifikasi di sesi baru dengan prompt "List the skills you have available" — harus muncul `brainstorming`, `writing-plans`, `test-driven-development`, `verification-before-completion`, dll. Jika tidak: install ulang dengan prompt resmi README superpowers: `Fetch and follow instructions from https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/.opencode/INSTALL.md`, lalu restart opencode.
**Konfigurasi opencode proyek:** `opencode.json` sudah ada (deny baca `.env`, `git push` = ask, dll.). Jalankan opencode di root repo; jika ada error config, perbaiki JSON-nya (schema: https://opencode.ai/config.json). Catatan jujur: aturan permission ini mengurangi kebocoran tidak sengaja, **bukan sandbox**.

## C. Akun, key, dana (≈45–90 menit; mulai dari faucet karena bisa lambat) — [M]
1. **Faucet test ETH** untuk Sepolia (dua alamat: deployer & executor). Cari faucet yang masih aktif hari ini (faucet sering rate-limit/berubah; saya tidak memverifikasi status 2026). Minta secepatnya, ulangi nanti jika perlu.
2. **Buat 3 key baru (khusus testnet):**
   ```bash
   cast wallet new   # jalankan 3x: deployer, executor, demo-owner. Simpan di password manager
   ```
   Jangan pakai key mainnet/MetaMask utama. `cast wallet *` sengaja di-deny untuk agent: hanya manusia.
3. **Owner nyata (opsional P1):** akun MetaMask khusus testnet untuk demo wallet-mode; salin alamat publik ke `OWNER_ADDRESS`.
4. **RPC:** daftar Alchemy/Infura (gratis) atau pakai RPC publik; isi `RPC_URL` (satu RPC; fallback belum diimplementasikan). `EXPLORER_BASE_URL=https://sepolia.etherscan.io`. API key explorer (opsional, untuk verifikasi source) → `ETHERSCAN_API_KEY`.
5. **LLM:** pilih provider/model (D-006). Buat API key **khusus proyek**, pasang **batas pemakaian/budget** di dashboard provider. Isi `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`.
6. `cp .env.example .env` di **masing-masing mesin** dan isi. `.env` tidak boleh di-commit (sudah di `.gitignore`). Bagikan key lewat password manager, bukan chat publik.
7. Jalankan `scripts/preflight.sh` (tambah `--chain` untuk ping RPC). Harus `PREFLIGHT OK`. Untuk dev lokal awal pakai `CHAIN_ID=31337`, `RPC_URL=http://127.0.0.1:8545` dan key default anvil (publik; hanya lokal!).
8. Kirim email ke panitia (`docs/submission/EMAIL-TO-ORGANIZERS.md`). **To:** `fintechathon@ican-x.com` · **CC:** `info@ican-x.com` (D-017). Simpan salinan terkirim dan balasannya.

## D. Hosting (bisa ditunda sampai M3, tapi daftar sekarang) — [M]
Satu server Node melayani API + static web (D-008). Pilih satu: Render / Railway / Fly.io (free tier bisa tidur → cold start lambat; cek harga/limit sendiri). Siapkan akun, belum deploy. Env var di dashboard hosting, bukan di repo. Fallback demo: tunnel dari laptop (hanya jika laptop online saat juri menilai).

## E. Serah-terima ke agent — [M] lalu [A]
1. Dev B: buka opencode, paste prompt Dev B (`tasks/PROMPTS.md`). Dev A: prompt Dev A.
2. Pantau `STATUS.md`; tiap tugas ditutup dengan `scripts/verify-all.sh`.
3. Perintah yang butuh `ask` (push, forge script/broadcast, cast send, anvil) → manusia menyetujui di opencode.

## F. Checklist "siap start" (semua harus ✔ sebelum jam kerja penuh)
- [ ] Repo di GitHub, kedua dev bisa push
- [ ] Node 22 + pnpm di kedua mesin; Foundry di mesin Dev A
- [ ] `.env` terisi di kedua mesin, `preflight.sh` OK
- [ ] Test ETH masuk di deployer & executor (atau permintaan faucet sudah diajukan)
- [ ] LLM key + batas pemakaian
- [ ] Email panitia terkirim (To `fintechathon@ican-x.com`, CC `info@ican-x.com`)
- [ ] Semua kerja di WSL `~/` (bukan `/mnt/c`), repo GitHub dibuat kosong
- [ ] Prompt awal sudah dipaste di kedua opencode
