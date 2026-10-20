export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type TokenSymbol = 'mUSDC' | 'mWETH' | 'mWSTETH';
export type ActionType = 'REPAY' | 'SUPPLY_COLLATERAL' | 'SWAP' | 'BORROW';

export type ErrorName =
  | 'NotOwner'
  | 'NotExecutor'
  | 'Paused'
  | 'MandateInactive'
  | 'MandateExpired'
  | 'StaleAction'
  | 'DeadlineExpired'
  | 'ZeroAmount'
  | 'ActionNotAllowed'
  | 'BorrowForbidden'
  | 'TargetNotAllowed'
  | 'AssetLocked'
  | 'StalePrice'
  | 'PriceDeviation'
  | 'PerActionCapExceeded'
  | 'BudgetExceeded'
  | 'SlippageExceeded'
  | 'PostConditionFailed'
  | 'BadSignature'
  | 'BadNonce'
  | 'SignatureExpired';

export interface Mandate {
  id: bigint;
  validFrom: bigint;
  validUntil: bigint;
  maxTotalSpendUsd: bigint;
  maxPerActionUsd: bigint;
  minLiquidReserveUsd: bigint;
  maxSlippageBps: number;
  maxPriceAgeSec: number;
  maxPriceDeviationBps: number;
  allowedActions: number;
  allowBorrow: boolean;
  allowedTargets: Address[];
  lockedTokens: Address[];
}

export interface MandateDraft {
  mandate: Omit<Mandate, 'id'>;
  humanSummary: string;
  clarifications: { field: string; question: string }[];
  assumptions: { field: string; value: string; reason: 'default' | 'inferred' }[];
}

export interface PositionSnapshot {
  poolId: 0 | 1;
  collateralToken: Address;
  debtToken: Address;
  collateral: bigint;
  debt: bigint;
  healthFactor: bigint;
  ltBps: number;
  liqBonusBps: number;
  closeFactorBps: number;
}

export interface PriceSnapshot {
  token: Address;
  priceUsd8: bigint;
  updatedAt: bigint;
}

export interface VaultSnapshot {
  blockNumber: bigint;
  blockTimestamp: bigint;
  paused: boolean;
  activeMandateId: bigint;
  actionNonce: bigint;
  spentUsd8: bigint;
  liquidReserveUsd8: bigint;
  balances: Record<Address, bigint>;
}

export interface Action {
  mandateId: bigint;
  nonce: bigint;
  actionType: ActionType;
  target: Address;
  poolId: number;
  tokenIn: Address;
  tokenOut: Address | null;
  amount: bigint;
  minAmountOut: bigint;
  quotedPriceUsd8: bigint;
  deadline: bigint;
}

export interface RationaleFacts {
  poolId: number;
  hfBefore: bigint;
  hfAfterExpected: bigint;
  lossBeforeUsd8: bigint;
  lossAfterUsd8: bigint;
  spendUsd8: bigint;
  levelName: string;
}

export interface PlanAction {
  index: number;
  action: Action;
  rationale: RationaleFacts;
}

export type HaltReason =
  | { kind: 'BUDGET_INSUFFICIENT'; neededUsd8: bigint; availableUsd8: bigint }
  | { kind: 'STALE_OR_CONFLICTING_DATA'; detail: string }
  | { kind: 'MANDATE_INVALID'; error: ErrorName }
  | { kind: 'PAUSED' }
  | { kind: 'NEEDS_OWNER_DECISION'; detail: string };

export interface Plan {
  planId: string;
  version: number;
  basedOnBlock: bigint;
  actions: PlanAction[];
  totalSpendUsd8: bigint;
  expectedLossUsd8: bigint;
  unsavedPools: number[];
  haltReason?: HaltReason;
}

export interface PolicyContext {
  caller: Address;
  executor: Address;
  tokenDecimals: Record<Address, number>;
  pools: Record<number, { collateralToken: Address; debtToken: Address }>;
}

export interface PostConditionContext {
  action: Action;
  mandate: Mandate;
}

export interface PostConditionSnapshot {
  liquidReserveUsd8: bigint;
  healthFactor: bigint;
}

export interface AuditEntry {
  seq: number;
  ts: number;
  runId: string;
  kind: string;
  data: unknown;
  prevHash: Hex;
  hash: Hex;
}

export interface LedgerEntry {
  runId: string;
  actionIndex: number;
  txHash?: Hex;
  mandateId: bigint;
  spendUsd8: bigint;
  gasWei: bigint;
  gasUsd8: bigint | null;
  status: 'mined' | 'reverted' | 'unknown';
  error?: ErrorName;
  ts: number;
}
