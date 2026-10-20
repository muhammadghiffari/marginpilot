import type {
  Action,
  Address,
  ErrorName,
  Mandate,
  PolicyContext,
  PostConditionContext,
  PostConditionSnapshot,
  PriceSnapshot,
  VaultSnapshot,
} from './types.js';
import { mulDivFloor, usd8Ceil } from './valuation.js';

export type PolicyResult = { ok: true; valueUsd8: bigint } | { ok: false; error: ErrorName };
export type PostConditionResult = { ok: true } | { ok: false; error: 'PostConditionFailed' };

/** Missing trusted configuration means fail closed; callers surface this as Unknown. */
export class PolicyConfigError extends Error {
  override name = 'PolicyConfigError';
}

const BPS = 10_000n;

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function includesAddress(addresses: Address[], target: Address): boolean {
  return addresses.some((address) => sameAddress(address, target));
}

function actionBit(action: Action): number {
  switch (action.actionType) {
    case 'REPAY':
      return 1;
    case 'SUPPLY_COLLATERAL':
      return 2;
    case 'SWAP':
      return 4;
    case 'BORROW':
      return 0;
  }
}

function priceMap(prices: PriceSnapshot[]): Map<string, bigint> {
  const map = new Map<string, bigint>();
  for (const { token, priceUsd8 } of prices) {
    const key = token.toLowerCase();
    const existing = map.get(key);
    if (existing !== undefined && existing !== priceUsd8) throw new Error(`conflicting prices for ${token}`);
    map.set(key, priceUsd8);
  }
  return map;
}

function decimalsOf(ctx: PolicyContext, token: Address): number {
  const entry = Object.entries(ctx.tokenDecimals).find(([address]) => address.toLowerCase() === token.toLowerCase());
  if (entry === undefined) throw new PolicyConfigError(`missing token decimals for ${token}`);
  return entry[1];
}

function poolOf(ctx: PolicyContext, poolId: number): { collateralToken: Address; debtToken: Address } {
  const pool = ctx.pools[poolId];
  if (pool === undefined) throw new PolicyConfigError(`missing pool metadata for pool ${poolId}`);
  return pool;
}

function lendingAction(action: Action): boolean {
  return action.actionType === 'REPAY' || action.actionType === 'SUPPLY_COLLATERAL' || action.actionType === 'BORROW';
}

function priceSet(action: Action, ctx: PolicyContext): Address[] {
  // D-031: the reserve token is priced for every action because check #16 values the reserve with it.
  const tokens: Address[] = [action.tokenIn, ctx.reserveToken];
  if (action.actionType === 'SWAP') {
    if (action.tokenOut === null) throw new PolicyConfigError('SWAP is missing tokenOut');
    tokens.push(action.tokenOut);
  } else if (lendingAction(action)) {
    const pool = poolOf(ctx, action.poolId);
    tokens.push(pool.collateralToken, pool.debtToken);
  }
  return [...new Map(tokens.map((token) => [token.toLowerCase(), token])).values()];
}

function valueUsd8(action: Action, oraclePriceUsd8: bigint, ctx: PolicyContext): bigint {
  if (action.actionType === 'BORROW') return 0n;
  return usd8Ceil(action.amount, decimalsOf(ctx, action.tokenIn), oraclePriceUsd8);
}

export function checkAction(
  mandate: Mandate | null,
  vault: VaultSnapshot,
  prices: PriceSnapshot[],
  action: Action,
  now: bigint,
  ctx: PolicyContext,
): PolicyResult {
  // #1
  if (!sameAddress(ctx.caller, ctx.executor)) return { ok: false, error: 'NotExecutor' };
  // #2
  if (vault.paused) return { ok: false, error: 'Paused' };
  // #3
  if (mandate === null || vault.activeMandateId === 0n || mandate.id !== vault.activeMandateId) {
    return { ok: false, error: 'MandateInactive' };
  }
  // #4
  if (action.mandateId !== vault.activeMandateId || action.nonce !== vault.actionNonce) {
    return { ok: false, error: 'StaleAction' };
  }
  // #5
  if (now > action.deadline) return { ok: false, error: 'DeadlineExpired' };
  // #6
  if (now < mandate.validFrom || now > mandate.validUntil) return { ok: false, error: 'MandateExpired' };
  // #7
  if (action.amount <= 0n) return { ok: false, error: 'ZeroAmount' };
  // #8
  if (action.actionType === 'BORROW' && !mandate.allowBorrow) return { ok: false, error: 'BorrowForbidden' };
  if (action.actionType !== 'BORROW' && (mandate.allowedActions & actionBit(action)) === 0) {
    return { ok: false, error: 'ActionNotAllowed' };
  }
  // #9
  if (!includesAddress(mandate.allowedTargets, action.target)) return { ok: false, error: 'TargetNotAllowed' };
  // #9b (D-032): a SWAP must not target the lending simulator. The vault probes pools(poolId)
  // with a staticcall right after #9; the equality check here is the pure mirror of that probe.
  // D-032 also keeps the trusted-context approximation: a SWAP whose target is not the configured
  // swap target is rejected here, while the vault names that failure only at the target call
  // (untyped revert → D-029 Unknown). Dev A declined the feeBps() probe; MockSwap is unchanged.
  if (
    action.actionType === 'SWAP'
    && (sameAddress(action.target, ctx.lendingSim)
      || ctx.swapTarget === undefined
      || !sameAddress(action.target, ctx.swapTarget))
  ) {
    return { ok: false, error: 'TargetNotAllowed' };
  }
  // #10
  if ((action.actionType === 'REPAY' || action.actionType === 'SWAP') && includesAddress(mandate.lockedTokens, action.tokenIn)) {
    return { ok: false, error: 'AssetLocked' };
  }
  // #11 (D-030): the lending role check. The vault probes pools(poolId) while building the #11
  // price set, so this error lands after #10 and before the freshness loop (unlike the SWAP
  // probe, which the vault places at #9b). Mirror approximates the probe with equality.
  if (lendingAction(action) && !sameAddress(action.target, ctx.lendingSim)) {
    return { ok: false, error: 'TargetNotAllowed' };
  }

  let pricesByToken: Map<string, bigint>;
  try {
    pricesByToken = priceMap(prices);
  } catch {
    return { ok: false, error: 'StalePrice' };
  }
  let tokens: Address[];
  try {
    tokens = priceSet(action, ctx);
  } catch (error) {
    if (error instanceof PolicyConfigError) throw error;
    return { ok: false, error: 'StalePrice' };
  }
  // #11 (D-023)
  for (const token of tokens) {
    const updated = prices.find((price) => sameAddress(price.token, token));
    const oraclePrice = pricesByToken.get(token.toLowerCase());
    if (updated === undefined || oraclePrice === undefined || updated.updatedAt > now) {
      return { ok: false, error: 'StalePrice' };
    }
    if (now - updated.updatedAt > BigInt(mandate.maxPriceAgeSec)) return { ok: false, error: 'StalePrice' };
  }

  const oraclePriceUsd8 = pricesByToken.get(action.tokenIn.toLowerCase());
  if (oraclePriceUsd8 === undefined) return { ok: false, error: 'StalePrice' };
  // #12
  if (action.quotedPriceUsd8 <= 0n) return { ok: false, error: 'PriceDeviation' };
  const difference = oraclePriceUsd8 > action.quotedPriceUsd8
    ? oraclePriceUsd8 - action.quotedPriceUsd8
    : action.quotedPriceUsd8 - oraclePriceUsd8;
  if (difference * BPS > BigInt(mandate.maxPriceDeviationBps) * action.quotedPriceUsd8) {
    return { ok: false, error: 'PriceDeviation' };
  }

  const value = valueUsd8(action, oraclePriceUsd8, ctx);
  // #13
  if (value > mandate.maxPerActionUsd) return { ok: false, error: 'PerActionCapExceeded' };
  // #14
  if (vault.spentUsd8 + value > mandate.maxTotalSpendUsd) return { ok: false, error: 'BudgetExceeded' };

  // #15
  if (action.actionType === 'SWAP') {
    if (action.tokenOut === null) throw new PolicyConfigError('SWAP is missing tokenOut');
    const outPrice = pricesByToken.get(action.tokenOut.toLowerCase());
    if (outPrice === undefined) return { ok: false, error: 'StalePrice' };
    const fairOut = mulDivFloor(
      action.amount * oraclePriceUsd8,
      10n ** BigInt(decimalsOf(ctx, action.tokenOut)),
      10n ** BigInt(decimalsOf(ctx, action.tokenIn)) * outPrice,
    );
    const minimumFairOut = mulDivFloor(fairOut, BPS - BigInt(mandate.maxSlippageBps), BPS);
    if (action.minAmountOut < minimumFairOut) return { ok: false, error: 'SlippageExceeded' };
  }

  return { ok: true, valueUsd8: value };
}

export function checkPostConditions(
  ctx: PostConditionContext,
  before: PostConditionSnapshot,
  after: PostConditionSnapshot,
): PostConditionResult {
  if (after.liquidReserveUsd8 < ctx.mandate.minLiquidReserveUsd) {
    return { ok: false, error: 'PostConditionFailed' };
  }
  if (lendingAction(ctx.action) && after.healthFactor < before.healthFactor) {
    return { ok: false, error: 'PostConditionFailed' };
  }
  return { ok: true };
}
