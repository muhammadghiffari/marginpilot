# 00 — START HERE

## Produknya dalam 5 kalimat
User menulis instruksi biasa ("lindungi pinjaman saya, maksimal $260, jangan sentuh ETH saya"). Agent menyusun **mandat** terstruktur, user menandatanganinya (EIP-712), lalu agent menyelamatkan 2 posisi pinjaman yang terancam likuidasi dengan dana terbatas. Setiap aksi harus lolos `MandateVault` di blockchain: anggaran kumulatif, aset terkunci, aksi yang diizinkan, kesegaran harga. Batas itu tetap berlaku saat agent replanning, saat transaksi gagal, bahkan kalau key agent bocor. Pasar lending-nya simulasi (`LendingSim`); enforcement dan transaksinya nyata di testnet.

## Mengapa ini, bukan ide lain (ringkas)
Rubrik menilai task completion 40, security 30, innovation & interaction 30, bonus on-chain 0–5. Security adalah syarat semua topik, bukan pembeda. Pembeda kita: batas yang bertahan lintas replanning (diukur lewat ablation), interaksi yang jelas, dan bukti terukur. Kita **tidak** mengklaim "pertama" atau "belum terpecahkan": prior art padat (lihat `research/NOVELTY-AND-PRIOR-ART.md`).

## Pembagian orang
- **Owner/infra (Ghiffari)** = setup, akun, key, faucet, hosting, + **Dev A** (kontrak & chain).
- **Dev B (teman)** = `packages/`, `apps/`, harness eval. Bisa mulai **sekarang** hanya dengan Node 22 + pnpm; tidak menunggu infra.
(Kalau peran terbalik, tukar nama saja. Kepemilikan berdasarkan folder.)

## Hal yang HARUS dikonfirmasi pertama (manusia)
1. Deadline: percakapan menyebut **20 Okt 2026 22:59 WIB**, tapi tidak tertulis di teks aturan yang ditempel. Cek situs/email.
2. Jaringan on-chain yang diterima (testnet?) → kirim email `docs/submission/EMAIL-TO-ORGANIZERS.md` sekarang.
3. Cara submit (email/portal) dan format.

## Keputusan yang masih terbuka (lihat `DECISIONS.md`)
D-003 jaringan testnet (VERIFY, tanya panitia) · D-006 model LLM (OPEN) · D-013 lisensi (OPEN; `LICENSE` masih placeholder) · D-016 nama tim/brand (OPEN) · D-018 aturan komposisi tim "60% non-WNC" (VERIFY; tulis kutipan sumbernya) · D-020 "defensive learning" dan D-021 "multi-agent" (OPEN; agent dilarang mengerjakan sebelum DECIDED). Sisanya sudah DECIDED.

## Langkah cepat (urutan)
1. Owner: `docs/01-SETUP-INFRA.md` bagian A–C (≈60–90 menit), push repo.
2. Dev B: clone → `scripts/preflight.sh` → buka opencode → paste prompt Dev B di `tasks/PROMPTS.md`.
3. Dev A: setelah Foundry terpasang → prompt Dev A.
4. Baca `03-TIMELINE.md` untuk milestone dan **cut line**.
5. `04-MANUAL-VS-AUTO.md` = tabel siapa mengerjakan apa (agent vs manusia).

## Aturan emas
Jangan ada hash/angka/sitasi karangan. Semua angka dari `pnpm eval:run`. Semua hash harus bisa dibuka di explorer. Tulis "tidak ditemukan pelanggaran pada N skenario", bukan "aman 100%".
