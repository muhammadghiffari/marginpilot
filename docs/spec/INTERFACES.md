# INTERFACES — shared contracts between Dev A and Dev B

This file is the seam. Dev B can build against `MockChainPort` before Dev A has anything deployed.

## 1. Numeric conventions (TypeScript)
- All money/price/HF values are `bigint`. JSON transport uses **decimal strings** (`"12500000"`); zod schemas convert.
- `usd8` USD×1e8 · `wad` 1e18 = HF 1.0 · token amounts in raw units · bps integers · timestamps unix seconds.
- Never use `number` for money. Display formatting lives only in `apps/web`.

## 2. Error names (shared with Solidity, exact)
```ts
export type ErrorName =
  | "NotOwner" | "NotExecutor" | "Paused" | "MandateInactive" | "MandateExpired"
  | "StaleAction" | "DeadlineExpired" | "ZeroAmount" | "ActionNotAllowed" | "BorrowForbidden"
  | "TargetNotAllowed" | "AssetLocked" | "StalePrice" | "PriceDeviation" | "PerActionCapExceeded"
  | "BudgetExceeded" | "SlippageExceeded" | "PostConditionFailed"
  | "BadSignature" | "BadNonce" | "SignatureExpired";
```

## 3. Core types (`packages/core/src/types.ts`)
```ts
export type Address = `0x${string}`;
export type TokenSymbol = "mUSDC" | "mWETH" | "mWSTETH";
export type ActionType = "REPAY" | "SUPPLY_COLLATERAL" | "SWAP" | "BORROW"; // enum order 0..3

export interface Mandate {              // mirrors Solidity struct field for field
  id: bigint; validFrom: bigint; validUntil: bigint;
  maxTotalSpendUsd: bigint; maxPerActionUsd: bigint; minLiquidReserveUsd: bigint;
  maxSlippageBps: number; maxPriceAgeSec: number; maxPriceDeviationBps: number;
  allowedActions: number;               // bit0 REPAY, bit1 SUPPLY_COLLATERAL, bit2 SWAP
  allowBorrow: boolean;
  allowedTargets: Address[]; lockedTokens: Address[];
}
export interface MandateDraft {         // output of compile_mandate (LLM) — NOT authoritative
  mandate: Omit<Mandate, "id"> ;
  humanSummary: string;                 // grounded in the fields, validated by groundingCheck
  clarifications: { field: string; question: string }[];  // non-empty => cannot be confirmed
  assumptions: { field: string; value: string; reason: "default" | "inferred" }[];
}
export interface PositionSnapshot {
  poolId: 0 | 1; collateralToken: Address; debtToken: Address;
  collateral: bigint; debt: bigint; healthFactor: bigint /* wad */;
  ltBps: number; liqBonusBps: number; closeFactorBps: number;
}
export interface PriceSnapshot { token: Address; priceUsd8: bigint; updatedAt: bigint }
export interface VaultSnapshot {
  blockNumber: bigint; blockTimestamp: bigint;
  paused: boolean; activeMandateId: bigint; actionNonce: bigint;
  spentUsd8: bigint; liquidReserveUsd8: bigint; balances: Record<Address, bigint>;
}
export interface Action {               // mirrors Solidity struct
  mandateId: bigint; nonce: bigint; actionType: ActionType; target: Address; poolId: number;
  tokenIn: Address; tokenOut: Address | null; amount: bigint; minAmountOut: bigint;
  quotedPriceUsd8: bigint; deadline: bigint;
}
export interface PlanAction { index: number; action: Action; rationale: RationaleFacts }
export interface RationaleFacts {       // all numbers the explanation may cite; nothing else may be cited
  poolId: number; hfBefore: bigint; hfAfterExpected: bigint;
  lossBeforeUsd8: bigint; lossAfterUsd8: bigint; spendUsd8: bigint; levelName: string;
}
export interface Plan {
  planId: string; version: number; basedOnBlock: bigint;
  actions: PlanAction[]; totalSpendUsd8: bigint; expectedLossUsd8: bigint;
  unsavedPools: number[];               // pools the plan cannot protect with the remaining budget
  haltReason?: HaltReason;              // set instead of actions when tier-3 applies
}
export type HaltReason =
  | { kind: "BUDGET_INSUFFICIENT"; neededUsd8: bigint; availableUsd8: bigint }
  | { kind: "STALE_OR_CONFLICTING_DATA"; detail: string }
  | { kind: "MANDATE_INVALID"; error: ErrorName }
  | { kind: "PAUSED" } | { kind: "NEEDS_OWNER_DECISION"; detail: string };
```

## 4. Ports (the seams)
```ts
import type { Hex } from "viem";
export interface ChainPort {            // implemented by MockChainPort (Dev B) and ViemChainPort (Dev A/B)
  getVault(): Promise<VaultSnapshot>;
  getPositions(): Promise<PositionSnapshot[]>;
  getPrices(tokens: Address[]): Promise<PriceSnapshot[]>;
  getMandate(): Promise<Mandate | null>;
  simulate(a: Action): Promise<{ ok: true; valueUsd8: bigint } | { ok: false; error: ErrorName | "Unknown"; raw?: string }>;
  submit(a: Action): Promise<SubmitResult>;       // MUST simulate first; MUST NOT resubmit on timeout
  getTx(hash: Hex): Promise<TxStatus>;            // used to reconcile UNKNOWN submissions
  pause(): Promise<Hex>;
  // demo-only (DEMO_MODE): throw if disabled
  demoSetPrice(token: Address, priceUsd8: bigint, updatedAt?: bigint): Promise<Hex>;
  demoSetPoolPaused(pool: number, paused: boolean): Promise<Hex>;
}
export type TxStatus =                          // added in handover review (D-024); refine via spec PR if B-06 needs more
  | { status: "not_found" }
  | { status: "pending" }
  | { status: "mined"; success: boolean; blockNumber: bigint; gasUsed: bigint; effectiveGasPrice: bigint; error?: ErrorName | "Unknown" };
export type SubmitResult =
  | { status: "mined"; txHash: Hex; blockNumber: bigint; gasUsed: bigint; effectiveGasPrice: bigint }
  | { status: "reverted"; txHash: Hex; error: ErrorName | "Unknown"; gasUsed: bigint; effectiveGasPrice: bigint }
  | { status: "unknown"; txHash: Hex };         // timeout: caller must reconcile via getTx, never resend
```

`MockChainPort` must implement the **same math and the same ordered checks** as `CONTRACTS.md` (it is also the differential-test oracle, FR-16). It can throw the same `ErrorName`s.

## 5. Policy mirror (`packages/core/src/policy.ts`)
`checkAction(mandate, vault, prices, action, now): { ok: true; valueUsd8: bigint } | { ok: false; error: ErrorName }` — pure, follows the check order table in `CONTRACTS.md` §2.5 exactly. Used for (a) pre-flight in the agent, (b) differential tests, (c) config C of the ablation.

## 6. State machines
**Action machine**
```
PROPOSED --policy.checkAction ok--> VALIDATED --simulate ok--> AUTHORIZED --mined--> EXECUTED --post-read ok--> VERIFIED
PROPOSED|VALIDATED|AUTHORIZED --reject (ErrorName)--> REJECTED
AUTHORIZED --reverted--> REJECTED(error)           (no spend recorded)
AUTHORIZED --status unknown--> UNKNOWN --reconcile--> EXECUTED | REJECTED
EXECUTED --post-read mismatch--> MISMATCH --> run goes to REPLANNING with fresh snapshot
```
**Run machine**
```
IDLE -> OBSERVING -> PLANNING -> (AWAITING_APPROVAL if autoExecute=false) -> EXECUTING -> VERIFYING
VERIFYING -> COMPLETED            (every protectable pool reached target, within mandate)
VERIFYING -> REPLANNING -> PLANNING   (price moved / action rejected / mismatch; budget = remaining, never reset)
PLANNING|EXECUTING -> HALTED_NEEDS_OWNER (HaltReason set)   // tier 3
any -> ABORTED (kill switch / unrecoverable)   COMPLETED_PARTIAL (budget exhausted, unsavedPools non-empty, explained)
```
Hard rules: max 3 replans per run (config `MAX_REPLANS`), a run never moves to EXECUTING without a VALIDATED plan, and **nothing leaves HALTED_NEEDS_OWNER except an owner action** (new signed mandate or explicit continue).

## 7. Off-chain ledger & audit log
```ts
export interface LedgerEntry {
  runId: string; actionIndex: number; txHash?: Hex; mandateId: bigint;
  spendUsd8: bigint;                    // from ActionExecuted event, 0 if reverted
  gasWei: bigint; gasUsd8: bigint | null; // reported separately, NOT counted against the on-chain budget
  status: "mined" | "reverted" | "unknown"; error?: ErrorName; ts: number;
}
export interface AuditEntry { seq: number; ts: number; runId: string; kind: string; data: unknown; prevHash: Hex; hash: Hex }
// hash = keccak256(prevHash || canonicalJson({seq,ts,runId,kind,data})); first prevHash = 0x00..00
```
Audit kinds (minimum): `mandate.compiled`, `mandate.confirmed`, `observe`, `plan`, `plan.explained`, `action.validated`, `action.submitted`, `action.mined`, `action.rejected`, `replan`, `halt`, `abort`, `report`, `injection.suspected`. Secrets must be redacted before logging (see `AGENT-DESIGN.md`).

## 8. EIP-712 (viem) — must match Solidity typehash strings exactly
```ts
export const domain = (chainId: number, vault: Address) =>
  ({ name: "MarginPilotVault", version: "1", chainId, verifyingContract: vault }) as const;
export const types = {
  Mandate: [
    { name: "id", type: "uint64" }, { name: "validFrom", type: "uint64" }, { name: "validUntil", type: "uint64" },
    { name: "maxTotalSpendUsd", type: "uint128" }, { name: "maxPerActionUsd", type: "uint128" },
    { name: "minLiquidReserveUsd", type: "uint128" }, { name: "maxSlippageBps", type: "uint32" },
    { name: "maxPriceAgeSec", type: "uint32" }, { name: "maxPriceDeviationBps", type: "uint32" },
    { name: "allowedActions", type: "uint8" }, { name: "allowBorrow", type: "bool" },
    { name: "allowedTargets", type: "address[]" }, { name: "lockedTokens", type: "address[]" },
  ],
  SetMandate: [{ name: "mandate", type: "Mandate" }, { name: "deadline", type: "uint256" }],
} as const;
// primaryType: "SetMandate"
```

## 9. Deployments file (`deployments/<chainId>.json`)
```json
{ "chainId": 11155111, "deployedAt": "ISO-8601", "deployer": "0x..", "owner": "0x..", "executor": "0x..",
  "contracts": { "mUSDC": "0x..", "mWETH": "0x..", "mWSTETH": "0x..", "oracle": "0x..", "lending": "0x..", "swap": "0x..", "vault": "0x.." },
  "blocks": { "vault": 0 }, "explorerBase": "https://sepolia.etherscan.io" }
```
ABIs are exported by Dev A to `packages/core/src/abi/*.json` (`forge inspect <Contract> abi --json`) on every contract change.

## 10. HTTP API (apps/agent, Fastify or Express)
| Method + path | Body → Response |
|---|---|
| `POST /api/mandate/compile` | `{ text }` → `MandateDraft` (JSON strings for bigint) |
| `POST /api/mandate/confirm` | `{ draft, ownerMode: "demo" \| "wallet", signature? }` → `{ txHash, mandateId }` (demo mode signs server-side with `DEMO_OWNER_PRIVATE_KEY`; wallet mode takes the signature from the browser) |
| `POST /api/run` | `{ autoExecute: boolean }` → `{ runId }` |
| `GET /api/run/:id/events` | SSE stream of `RunEvent` (below) |
| `POST /api/run/:id/approve` | approves a plan in `AWAITING_APPROVAL` |
| `POST /api/vault/pause` | executor-initiated pause (kill switch) |
| `GET /api/state` | vault + positions + prices + mandate + ledger |
| `GET /api/audit?run=:id` | audit entries (redacted) |
| `POST /api/demo/shock` | `{ token, priceUsd8, updatedAt? }` (DEMO_MODE only) |
| `POST /api/demo/inject` | `{ kind: "poolPause" \| "swapBroken" \| "stalePrice" \| "poisonNote", value }` (DEMO_MODE only) |
`RunEvent`: `{ runId, seq, ts, type: "state" | "observe" | "plan" | "explanation" | "action" | "halt" | "report", payload }`.
All endpoints are rate-limited when `DEMO_MODE=true` (see `.env.example`).
