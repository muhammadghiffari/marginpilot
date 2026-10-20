# 04 — AUTO (agent) vs MANUAL (manusia)

## Sepenuhnya manusia (agent tidak boleh/bisa)
| Item | Siapa | Kapan | Catatan |
|---|---|---|---|
| Buat repo GitHub, undang collaborator | Owner | M0 | |
| Daftar akun: RPC, explorer, LLM, hosting | Owner | M0/M3 | |
| Generate 3 key (`cast wallet new`) & simpan aman | Owner | M0 | agent di-deny |
| Faucet (captcha/rate limit) | Owner | M0, ulangi | mulai paling awal |
| Isi `.env` di tiap mesin | Tiap dev | M0 | agent tidak boleh baca `.env` |
| Pasang batas biaya di dashboard LLM | Owner | M0 | |
| Kirim email panitia; baca Attachment 2 & situs (deadline, channel, video) | Owner | M0 | D-014..D-017 |
| Setujui perintah `ask` (push, broadcast, cast send, anvil) | Dev terkait | terus | baca sebelum setuju |
| Deploy ke testnet (hadir saat broadcast) | Dev A | M3 | |
| Tanda tangan mandat dengan wallet nyata (P1) | Owner | demo/evidence | |
| Verifikasi sumber riset (EVIDENCE.md `U`→`V-read`) | siapa saja | M4 | |
| Cek tiap tx hash di explorer; cek semua angka vs `eval/results` | Dua orang | M4–M5 | |
| Review klaim terlarang | Owner | M5 | |
| Submit & simpan konfirmasi; rekam video bila wajib | Owner | M5 | |
| Deploy hosting + set env var | Owner/Dev A | M3–M4 | |

## Semi-auto (agent mengerjakan, manusia menyetujui/menyaksikan)
Commit/push (ask), deploy lokal/testnet (ask), menjalankan eval live berbayar LLM, pengambilan screenshot evidence, pengisian template dokumen dari hasil nyata (manusia memeriksa).

## Auto (agent, tanpa menunggu manusia)
| Item | Task |
|---|---|
| Scaffold Foundry & pnpm, tipe, skema zod | A-01, B-01, B-02 |
| Kontrak mock, LendingSim, MandateVault + semua tes | A-01…A-06 |
| Optimizer, policy mirror, ledger, state machine, audit, redactor | B-03…B-06 |
| LLM layer, compile_mandate, orchestrator, server API | B-07…B-10 |
| UI web | B-11 |
| Eval harness Part 1/2 (+3) dan laporan | B-12…B-14 |
| Skrip deploy lokal, skenario, liquidator bot, ekspor ABI | A-07, A-09 |
| Menjalankan `verify-all.sh`, memperbarui `STATUS.md` | tiap tugas |
| Draft isi dokumen submission dari output nyata | M4 |

## Aturan serah-terima
Agent menandai TODO-manusia di `STATUS.md` dan tidak mengisi hal yang butuh keputusan/akun/key. Jika sesuatu terblokir manusia, agent lanjut ke tugas lain, bukan menunggu atau mengarang.
