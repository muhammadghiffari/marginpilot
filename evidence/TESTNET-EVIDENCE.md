# Testnet execution evidence

- Chain: `31337` (LOCAL ANVIL (SIMULATED))
- Generated: `2026-10-20T14:12:01Z`
- Deployment: `deployments/31337.json`
- Vault: `0x0165878A594ca255338adfa4d48449f69242Eb8F`
- Explorer: none (local anvil)

**This is a LOCAL ANVIL (SIMULATED) dry-run of the testnet evidence script. It is not public-testnet evidence.**

| Scenario id | Action | Expected error / result | Tx hash | Explorer |
|---|---|---|---|---|
| SETUP-MANDATE | setMandate(id=1) | accepted | `0xe193e6fd9fb49644285672d5218959d991538f33bd840c73f2e59e54e89e2c2b` | - |
| SETUP-SHOCK-WETH | setPrice(mWETH, 160000000000) | accepted | `0xfe1a93e627d7b87c158429677686a55115e417be251a506dd8ec183a780b8417` | - |
| SETUP-SHOCK-WSTETH | setPrice(mWSTETH, 184000000000) | accepted | `0x6c11f0f210297f01ecb3e2a5e475e07e12dc8d26a17a3fbb29e8473afd84039f` | - |
| H1-REPAY | REPAY pool 0 100 mUSDC (within caps) | accepted | `0xc73a071bfcb4d0d5c337330d8b3bd2caee48d2be8fe292eab5a6fc154af59ead` | - |
| R1-PER-ACTION | REPAY pool 0 200 mUSDC (above per-action cap) | PerActionCapExceeded | `0x8cfa03e478d7418fe8580c1c87fae7ecfaf5f4a44c8ea6a47ffd316b62bdc88a` | - |
| R2-BORROW | BORROW pool 0 1 mUSDC (allowBorrow=false) | BorrowForbidden | `0xe746fbe1f7feb6710daf4b3e18e1fcfdf6f7d7eda110b1ed2bea66f3f5d3e2d3` | - |
| R3-TARGET-ROLE | REPAY at the swap target (wrong role) | TargetNotAllowed | `0xe2244a03a759483a4c7c4b7e897449dad0b6849da6dc714950029879e609a9b4` | - |
| SETUP-STALE-PRICE | setPriceAt(mUSDC, 1e8, 1792419063) | accepted | `0xa5cad1f6696bee827c64b137f11957083d30b8faa2a6e1a5475e134d75a983b6` | - |
| R4-STALE-PRICE | REPAY pool 0 1 mUSDC (mUSDC price stale) | StalePrice | `0xbc9e08d6e406048dbc55945f7ce2bacb4386888a67e26edb4c5aeb25b4075e14` | - |
| SETUP-FRESH-PRICE | setPrice(mUSDC, 1e8) | accepted | `0x0a72850a378e4bcd501cc51a0ea0b675fdeb068bac88510ca4a37211857611c4` | - |
| SETUP-PAUSE | pause() | accepted | `0x3af6fe74b3779f4b69cc186cfdd0b4a6ffb362601172ee30e39756e7147f9eb9` | - |
| R5-PAUSED | REPAY pool 0 1 mUSDC (vault paused) | Paused | `0xd5a032aa51addeccd1a2d4f47388e51c4e4e2fd0465cad5a9ff6f6a200585387` | - |
| SETUP-UNPAUSE | unpause() | accepted | `0xe2ee53cc4531df3db92a3f85446c98157484524ec73644f0ea2cef2a6ebb9716` | - |
| SETUP-REVOKE | revokeMandate() | accepted | `0x2cb00fcddb9dc23b7b0b1e38e420f956f521a5f93c541656417366a46dfb8f62` | - |
| R6-MANDATE-INACTIVE | REPAY pool 0 1 mUSDC (mandate revoked) | MandateInactive | `0x60e232e7b078ab34facfa741bb766ff0fd686de476208cfdfd17367aacb36004` | - |

Each rejected action has two artifacts: a `cast call` simulation that decoded to the expected custom error (with selector in the JSON), and a mined transaction with receipt status `0x0`. The accepted action has receipt status `0x1`. Setup rows have no simulation.
