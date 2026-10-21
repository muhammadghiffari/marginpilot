# DEMO SCRIPT — 5 minutes (English + Bahasa Indonesia)

Two complete, presenter-ready scripts for the same run. Read the **Say** lines out loud; the
**Do** lines are what you click. Both scripts use the **live Sepolia deployment**, so every
transaction the audience sees resolves on a public block explorer.

- **English script:** §2 · **Naskah Bahasa Indonesia:** §3
- Setup to run beforehand: §1 · Fallbacks if something breaks: §4 · Numbers you may quote: §5 ·
  Claims to avoid: §6

---

## 1. Setup (do this before you record)

1. A funded Ethereum **Sepolia** deployment of the simulator + `MandateVault` is running and the
   agent serves the console in `testnet` mode:
   `ENV_FILE=<your-ignored-config> bash scripts/start-testnet.sh testnet`
   The ignored config sources your local `.env` (keys) and then sets `CHAIN_ID=11155111`, a public
   Sepolia `RPC_URL`, `EXPLORER_BASE_URL=https://sepolia.etherscan.io`, `OWNER_ADDRESS`,
   `EXECUTOR_ADDRESS`, `ALLOW_DEMO_CONTROLS=true`, `PORT`.
2. Open `http://<host>:<port>` and confirm the badge in the top-right reads
   **`TESTNET · sepolia.etherscan.io ↗`**.
3. Have these open in a second tab (they are the proof, not props):
   - Vault: `https://sepolia.etherscan.io/address/0xd7FC116f1acaE8cE017114aD7E41F132a998743C`
   - Recorded run: `evidence/sepolia-ui-e2e-20261021.json` (27 receipts, re-read from a second RPC)
4. Optional: `python3 apps/web/test/browser_testnet.py --base-url http://<host>:<port>` replays the
   whole flow automatically — use it as the backup recording.

---

## 2. English script

### 1. Hook — 0:00
**Do:** open the console; point at the green `TESTNET` badge.
**Say:** "An agent with a wallet is a risk: the model can be talked into anything. MarginPilot lets
one wallet act, but every limit lives in an on-chain vault the model cannot edit."
**Show:** the `TESTNET · sepolia.etherscan.io ↗` badge, and click it once — the vault opens on
Etherscan. Say: "Everything I am about to show is a real transaction on a public testnet."

### 2. The boundary — 0:20
**Do:** in "Mandate & plan", show `Total cap $260`, `Reserve floor $100`, `Locked assets mWETH`,
`Borrow Forbidden`.
**Say:** "The owner sets one budget across both positions, a reserve floor, and an asset lock. The
agent never chooses those numbers; the compiler only proposes them and the owner signs."

### 3. Mandate — 0:45
**Do:** type *"Protect my loans. Max $260. Don't touch my ETH. Keep $100 in reserve."* → **Draft
mandate** → **Sign & activate · owner key**.
**Say:** "This is an EIP-712 signature. The vault verifies it and rejects a replay, a wrong signer,
or an expired deadline. Note the transaction link under the mandate card — it is on the explorer."
**Show:** the `ACTIVE · TESTNET` badge and the mandate transaction link.

### 4. The market turns — 1:10
**Do:** open **Scenario lab · TESTNET CONTROLS** → click **`mWETH -20%`** → wait for the receipt
→ click **`mWSTETH -20%`** → wait again.
**Say:** "The prices are a simulator feed, and the owner can move them. Both positions now sit near
their thresholds."
**Show:** the **Positions** card: HF 0.943 and 1.051, "Below liquidation threshold".

### 5. Plan, not improvisation — 1:40
**Do:** click **Run rescue**; pause on the plan card.
**Say:** "The agent observes the chain, plans, and every action is checked by policy code before it
is submitted. It says what it will not do: no borrow, no locked asset, and it stays inside the
remaining budget."
**Show:** the plan: two REPAY actions, planned spend $250.16 of $260, and the residual-risk line.

### 6. Execute — 2:05
**Do:** watch the run; when the ledger fills, point at the two rows.
**Say:** "Each action is a transaction from the executor hot key, and the vault re-checks the
mandate, the nonce, the price freshness, the slippage and the health factor before it moves a
cent. The ledger shows the transaction hash; click it and it opens on Etherscan."
**Show:** `Action 1 · MINED` $86.57 and `Action 2 · MINED` $163.59, each with
*"view on sepolia.etherscan.io ↗"*.

### 7. The result — 2:35
**Do:** point at **Mandate boundary** and **Positions**.
**Say:** "Both positions are back above one. The agent spent $250.16 of the $260 the owner allowed
and stopped — it did not spend the rest, because the owner did not need to."
**Show:** budget $250.16 of $260, remaining $9.84; HF 1.005 and 1.117.

### 8. It fails closed — 3:00
**Do:** open the Scenario lab → **Refresh oracle timestamps** is not needed; instead press
**Make oracle stale** (or simply wait out the 600-second freshness window) → **Run rescue** again.
**Say:** "Now I break it on purpose. The price feed is stale, so the vault refuses the action and the
agent halts and asks the owner — no transaction, no spending, no silent guess. Then I refresh the
oracle timestamps and run again."
**Show:** `HALTED_NEEDS_OWNER — STALE_OR_CONFLICTING_DATA: simulation rejected: StalePrice`, then
**Refresh oracle timestamps** and a clean re-run.

### 9. Evidence and limits — 3:40
**Do:** show the Deployment card (vault, oracle, lending, swap, three tokens — each a link), then the
known-risks slide.
**Say:** "Seven contracts, every one verifiable, plus 331 automated tests. Be clear about the
limits: the contracts are unaudited, the lending market is our own simulator, the agent only ever
sees prices through the vault's checks, and we have not run a browser-wallet extension end to end."

### 10. Close — 4:30
**Say:** "The point is not that the model is smart. The point is that the model's freedom is capped
by something it cannot edit, verify, or talk its way around. Owner signs, vault enforces, explorer
proves."

---

## 3. Naskah Bahasa Indonesia

### 1. Hook — 0:00
**Do:** buka console; tunjuk badge hijau `TESTNET`.
**Say:** "Agent yang pegang dompet itu berisiko: modelnya bisa di-conditioning melakukan apa saja.
MarginPilot mengizinkan satu dompet bertindak, tapi semua batasnya hidup di vault on-chain yang
tidak bisa diedit model."
**Show:** badge `TESTNET · sepolia.etherscan.io ↗`; klik sekali — vault terbuka di Etherscan.
Kata: "Semua yang saya tunjukkan adalah transaksi sungguhan di testnet publik."

### 2. Batasannya — 0:20
**Do:** di kartu "Mandate & plan", tunjukkan `Total cap $260`, `Reserve floor $100`,
`Locked assets mWETH`, `Borrow Forbidden`.
**Say:** "Owner menentukan satu anggaran untuk dua posisi, batas minimum reserve, dan aset yang
dikunci. Agent tidak pernah memilih angka-angka itu; compiler hanya mengusulkan, owner yang
menandatangani."

### 3. Mandat — 0:45
**Do:** ketik *"Protect my loans. Max $260. Don't touch my ETH. Keep $100 in reserve."* → **Draft
mandate** → **Sign & activate · owner key**.
**Say:** "Ini tanda tangan EIP-712. Vault memverifikasinya dan menolak replay, penandatangan
yang salah, atau mandat kedaluwarsa. Perhatikan link transaksinya di bawah kartu mandat — ada di
explorer."
**Show:** badge `ACTIVE · TESTNET` dan link transaksi mandat.

### 4. Pasar berdarah — 1:10
**Do:** buka **Scenario lab · TESTNET CONTROLS** → klik **`mWETH -20%`** → tunggu receipt → klik
**`mWSTETH -20%`** → tunggu lagi.
**Say:** "Harga ini feed simulator, dan owner boleh mengubahnya. Dua posisi sekarang duduk di
sekitar batasnya."
**Show:** kartu **Positions**: HF 0.943 dan 1.051, "Below liquidation threshold".

### 5. Rencana, bukan improvisasi — 1:40
**Do:** klik **Run rescue**; berhenti sebentar di kartu plan.
**Say:** "Agent mengamati chain, menyusun rencana, dan tiap aksi dicek kode policy sebelum dikirim.
Dia juga bilang apa yang tidak akan dia lakukan: tidak borrow, tidak sentuh aset terkunci, dan
tetap di sisa anggaran."
**Show:** plan: dua aksi REPAY, planned spend $250.16 dari $260, plus baris residual risk.

### 6. Eksekusi — 2:05
**Do:** biarkan run berjalan; saat ledger terisi, tunjuk dua barisnya.
**Say:** "Tiap aksi adalah transaksi dari executor hot key, dan vault mengecek ulang mandat, nonce,
kesegaran harga, slippage, dan health factor sebelum memindahkan sepeser pun. Ledger menampilkan
hash transaksinya; klik, dan terbuka di Etherscan."
**Show:** `Action 1 · MINED` $86.57 dan `Action 2 · MINED` $163.59, masing-masing dengan
*"view on sepolia.etherscan.io ↗"*.

### 7. Hasilnya — 2:35
**Do:** tunjuk **Mandate boundary** dan **Positions**.
**Say:** "Dua posisi sudah naik lagi di atas satu. Agent menghabiskan $250,16 dari $260 yang
diizinkan owner, lalu berhenti — sisa tidak dibelanjakan, karena owner tidak butuh."
**Show:** budget $250.16 dari $260, sisa $9.84; HF 1.005 dan 1.117.

### 8. Gagal dengan aman — 3:00
**Do:** buka Scenario lab → **Refresh oracle timestamps** (tidak perlu; cukup tekan **Make oracle
stale**, atau tunggu jendela kesegaran 600 detik) → **Run rescue** lagi.
**Say:** "Sekarang saya sengaja rusak. Feed harga basi, jadi vault menolak aksinya dan agent
berhenti minta owner — tanpa transaksi, tanpa pengeluaran, tanpa menebak. Setelah saya segarkan
timestamp oracle, jalannya bersih lagi."
**Show:** `HALTED_NEEDS_OWNER — STALE_OR_CONFLICTING_DATA: simulation rejected: StalePrice`, lalu
**Refresh oracle timestamps** dan re-run yang bersih.

### 9. Bukti dan batas — 3:40
**Do:** tunjukkan kartu Deployment (vault, oracle, lending, swap, tiga token — semuanya ber-link),
lalu slide known-risks.
**Say:** "Tujuh kontrak, semuanya bisa diverifikasi, plus 331 tes otomatis. Dan saya harus jelas
batasnya: kontrak belum diaudit, pasar pinjamnya simulator milik kami sendiri, agent hanya melihat
harga lewat pemeriksaan vault, dan jalur browser-wallet belum pernah kita jalankan penuh."

### 10. Penutup — 4:30
**Say:** "Bukan soal modelnya pintar. Punkinya: kebebasan model dibatasi oleh sesuatu yang tidak
bisa ia edit, verifikasi, atau dibelanjakan dengan bicara. Owner menandatangani, vault
menegakkan, explorer membuktikan."

---

## 4. If something breaks (fallbacks)

| Symptom | What it means | Do this |
|---|---|---|
| Badge says `SIMULATED` or the page is stale | the agent is not in chain mode | restart with `bash scripts/start-testnet.sh testnet`; hard-refresh the page |
| `HALTED_NEEDS_OWNER — STALE_OR_CONFLICTING_DATA: simulation rejected: StalePrice` | the mandate's freshness window (600 s) expired — the vault refused the action | Scenario lab → **Refresh oracle timestamps** → run again |
| `COMPLETED` but `0 gated actions proposed` | both positions are safe, so there is nothing to rescue | shock a pool (`mWETH -20%` / `mWSTETH -20%`) and run again |
| `InvalidOwnerSignature` / "Signed by 0x…, but the deployment owner is 0x…" | the wallet signed with a different account | select the owner account in the wallet, or use **Sign & activate · owner key** |
| The RPC or the model provider fails | environment failure, not a product failure | play the recorded run: `evidence/sepolia-ui-e2e-20261021.json` (27 receipts, all `status 0x1`, re-read from a second public RPC) and the screenshots in `docs/submission/screenshots/` |

---

## 5. Numbers you may quote (and where they come from)

| Number | Value | Source |
|---|---|---|
| Chain | Ethereum Sepolia, chain id `11155111` | `deployments/11155111.json` |
| Vault | `0xd7FC116f1acaE8cE017114aD7E41F132a998743C` | deployment receipt `0xfbcd9ea5…c792cea` |
| Owner / executor | `0xdcf89b62…9c85C` / `0xe219FB39…BbD28` | `deployments/11155111.json` |
| Recorded run | `run-mvihf91d-1`, state `COMPLETED`, audit chain verified | `evidence/sepolia-ui-e2e-20261022.json` |
| Mandate transaction | `0xe70ba8018e05028f8d91b757a165bcd35b8df823eb95bb0fdadaa9cbfcf2f5a8` | same JSON |
| REPAY pool 0 / pool 1 | `0x756b52c8…34016e04` ($86.57) / `0xadb2d86c…0d5df5fb9` ($163.59) | same JSON |
| Spend | `$250.16` of `$260` (96.21 %), gas tracked separately | same JSON (`spentUsd(13) = 25016000000` USD8) |
| Health factors | pool 0 `0.942857… → 1.005002…`, pool 1 `1.051428… → 1.116670…` | same JSON |
| Tests | 331 (145 Forge, 89 core, 81 agent, 8 web, 8 eval) | `scripts/verify-all.sh` output |
| Second deployment (first run) | `0x2014c1F2…fFA1`, two runs, both `COMPLETED_PARTIAL` | `evidence/sepolia-e2e-20261021.json` |

---

## 6. Claims to avoid

- The lending market is a **simulator** (D-002). Say "real transactions on a public testnet against
  our own simulator contracts", never "rescued real positions" or "real DeFi".
- The contracts are **unaudited**; do not say "secure", "guaranteed", "first", or "unsolved".
- The live LLM provider was **not** exercised end to end (D-036): the demo runs the deterministic
  `ScriptedLlm`. The system's claim is that numbers come from code, not from prose.
- The browser-wallet path is implemented and unit/API tested, but **no MetaMask extension run has
  been recorded** — do not claim it was demoed live.
- The Part 1/Part 2 evaluation numbers are **SIMULATED** model metrics (`MockChainPort`); only the
  receipt tables in `evidence/` are on-chain facts.
