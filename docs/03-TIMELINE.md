# 03 — TIMELINE & CUT LINES

Jangkar: deadline **20 Okt 2026 22:59 WIB (DECIDED, D-014)**. Jadwal memakai waktu relatif **T+jam** dengan **T0 = saat kerja nyata dimulai**. Tabel di bawah mengasumsikan jendela **12 jam** (T0 ≈ 10:59 WIB, deadline = T+12:00). Konversi: WIB = T0 + offset. Jika T0 lebih lambat, potong dari buffer lalu dari *cut lines*; **jangan geser blok Submit terhadap deadline**.

| Waktu | Milestone | Dev A | Dev B | Owner/manual |
|---|---|---|---|---|
| T+0:00–1:00 | **M0 Setup** (WSL `~/`, repo kosong) | Foundry, A-01 mulai | B-01…B-03 (butuh Node saja) | Repo, key, faucet, RPC, LLM key, email panitia (To `fintechathon@ican-x.com`, CC `info@ican-x.com`) |
| T+1:00–3:30 | **M1 Foundations** | A-02…A-04 | B-04…B-06 | verifikasi 3 sumber (EVIDENCE) bila ada waktu |
| T+3:30–5:30 | A-05…A-07 (+I-1,I-2) | tes adversarial, deploy lokal | B-07, B-08 | istirahat/makan |
| T+5:30–7:00 | **M2 E2E di anvil** (I-3, I-4) | A-08, A-09 | B-09, B-10 | — |
| T+7:00–8:00 | **M3 Testnet** (I-5) | A-10 deploy + S1/S2/S7 nyata | UI B-11 berjalan | Setujui broadcast; cek hash di explorer |
| T+8:00 | **FEATURE FREEZE** | hanya bug fix | hanya bug fix | — |
| T+8:00–9:30 | **M4 Eval + docs** | A-11/A-13 hosting | B-12 eval, B-13 jika sempat | isi template submission dari hasil nyata |
| T+9:30–10:30 | Verifikasi akhir | bersihkan, `verify-all` di clone baru | UI/mobile cek | baca semua angka vs hasil; cek forbidden claims |
| T+10:30–11:00 | **M5 Submit** | — | — | package, submit, simpan konfirmasi |
| T+11:00–12:00 | Buffer | | | jangan dipakai untuk fitur |

Demo video bersifat opsional, maks 5 menit (D-015); tidak boleh mengorbankan blok M4/verifikasi.

## Cut lines (potong dari atas ke bawah jika telat)
1. T+3:30 belum ada `MandateVault` kompilasi → potong SWAP dari P0 (T01 lewat varian `ActionNotAllowed`), jangan potong tes.
2. T+5:30 belum E2E anvil → hentikan UI polish; fokus S1+S7 via script + UI minimal.
3. T+7:00 testnet belum jalan → deploy testnet tetap prioritas #1; tunda semua P1.
4. Urutan potong: P2 → memori → wallet-mode → Part 3 → differential test → S6/S8.
5. **Jangan pernah dipotong:** hash testnet nyata, gate on-chain, tes adversarial, known-risks jujur.
Jika T+5:30 situasi buruk, fallback: demo anvil + video + evidence testnet minimal S1 saja; jelaskan jujur.
