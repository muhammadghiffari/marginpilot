import { keccak256, stringToHex } from 'viem';

import { canonicalJson } from './schemas.js';
import type {
  Address,
  Action,
  Mandate,
  Plan,
  PositionSnapshot,
  PriceSnapshot,
  VaultSnapshot,
} from './types.js';
import { mulDivCeil, mulDivFloor, tokenCeil, usd8Ceil } from './valuation.js';

export interface OptimizerParams {
  /** Further collateral drop used by the stress term, in bps (1000 = 10%). */
  stressBps: number;
  /** Probability weight of the stress term, in bps (5000 = 0.5). */
  lambdaBps: number;
  hfSafeEpsWad: bigint;
  hfTargetWad: bigint;
  /** Rounding granularity for repay amounts, in usd8 (1_000_000 = one cent). */
  centUsd8: bigint;
}

export const DEFAULT_OPTIMIZER_PARAMS: OptimizerParams = {
  stressBps: 1_000,
  lambdaBps: 5_000,
  hfSafeEpsWad: 1_005_000_000_000_000_000n,
  hfTargetWad: 1_100_000_000_000_000_000n,
  centUsd8: 1_000_000n,
};

export interface OptimizerMarket {
  reserveToken: Address;
  lendingSim: Address;
  tokenDecimals: Record<Address, number>;
  now: bigint;
  version?: number;
}

export interface OptimizerInput {
  positions: PositionSnapshot[];
  prices: PriceSnapshot[];
  mandate: Mandate;
  vault: VaultSnapshot;
  market: OptimizerMarket;
  params?: Partial<OptimizerParams>;
}

export type LevelName = 'none' | 'safe-now' | 'safe-stress' | 'target';

export interface RepayLevel {
  name: LevelName;
  amount: bigint;
  spendUsd8: bigint;
  hfAfterWad: bigint;
  hfStressAfterWad: bigint;
  expectedLossUsd8: bigint;
}

export interface BaselineAllocation {
  poolId: number;
  amount: bigint;
  levelName: LevelName | 'partial-target';
  spendUsd8: bigint;
  expectedLossUsd8: bigint;
}

export interface BaselineResult {
  allocations: BaselineAllocation[];
  totalSpendUsd8: bigint;
  expectedLossUsd8: bigint;
  unsavedPools: number[];
}

type PriceMap = ReadonlyMap<Address, bigint>;

function resolveParams(overrides: Partial<OptimizerParams> | undefined): OptimizerParams {
  const params = { ...DEFAULT_OPTIMIZER_PARAMS, ...overrides };
  if (!Number.isInteger(params.stressBps) || params.stressBps < 0 || params.stressBps > 10_000) {
    throw new RangeError(`stressBps out of range: ${params.stressBps}`);
  }
  if (!Number.isInteger(params.lambdaBps) || params.lambdaBps < 0 || params.lambdaBps > 10_000) {
    throw new RangeError(`lambdaBps out of range: ${params.lambdaBps}`);
  }
  if (params.hfSafeEpsWad <= 0n || params.hfTargetWad <= 0n) throw new RangeError('HF goals must be positive');
  if (params.centUsd8 <= 0n) throw new RangeError('centUsd8 must be positive');
  return params;
}

function buildPriceMap(prices: PriceSnapshot[]): PriceMap {
  const map = new Map<Address, bigint>();
  for (const { token, priceUsd8 } of prices) {
    if (priceUsd8 <= 0n) throw new RangeError(`non-positive price for ${token}`);
    const existing = map.get(token);
    if (existing !== undefined && existing !== priceUsd8) throw new Error(`conflicting prices for ${token}`);
    map.set(token, priceUsd8);
  }
  return map;
}

function priceOf(prices: PriceMap, token: Address): bigint {
  const price = prices.get(token);
  if (price === undefined) throw new Error(`missing oracle price for ${token}`);
  return price;
}

function decimalsOf(market: OptimizerMarket, token: Address): number {
  const decimals = market.tokenDecimals[token];
  if (decimals === undefined) throw new Error(`missing token decimals for ${token}`);
  return decimals;
}

function debtUsd8(position: PositionSnapshot, prices: PriceMap, market: OptimizerMarket): bigint {
  return mulDivFloor(
    position.debt,
    priceOf(prices, position.debtToken),
    10n ** BigInt(decimalsOf(market, position.debtToken)),
  );
}

function collateralUsd8(position: PositionSnapshot, prices: PriceMap, market: OptimizerMarket): bigint {
  return mulDivFloor(
    position.collateral,
    priceOf(prices, position.collateralToken),
    10n ** BigInt(decimalsOf(market, position.collateralToken)),
  );
}

/** HF in wad at a collateral-price multiplier expressed in bps (10000 = current price). */
function hfAt(
  position: PositionSnapshot,
  debtRaw: bigint,
  prices: PriceMap,
  market: OptimizerMarket,
  multiplierBps: number,
): bigint {
  if (debtRaw === 0n) return (1n << 256n) - 1n;
  const debtValue = mulDivFloor(
    debtRaw,
    priceOf(prices, position.debtToken),
    10n ** BigInt(decimalsOf(market, position.debtToken)),
  );
  if (debtValue === 0n) throw new RangeError(`debt for pool ${position.poolId} rounds to zero usd8`);
  return mulDivFloor(
    collateralUsd8(position, prices, market) *
      BigInt(position.ltBps) *
      BigInt(multiplierBps) *
      10n ** 18n,
    1n,
    10_000n * 10_000n * debtValue,
  );
}

/** Height of debt (usd8) at which HF equals goalWad under the given price multiplier. */
function maxDebtUsd8(
  position: PositionSnapshot,
  prices: PriceMap,
  market: OptimizerMarket,
  goalWad: bigint,
  multiplierBps: number,
): bigint {
  return mulDivFloor(
    collateralUsd8(position, prices, market) * BigInt(position.ltBps) * BigInt(multiplierBps),
    10n ** 18n,
    10_000n * 10_000n * goalWad,
  );
}

function roundUpTo(value: bigint, unit: bigint): bigint {
  if (value <= 0n) return 0n;
  return mulDivCeil(value, 1n, unit) * unit;
}

function lossIfLiquidated(
  position: PositionSnapshot,
  debtRaw: bigint,
  prices: PriceMap,
  market: OptimizerMarket,
  multiplierBps: number,
): bigint {
  if (hfAt(position, debtRaw, prices, market, multiplierBps) >= 10n ** 18n) return 0n;
  const debtValue = mulDivFloor(
    debtRaw,
    priceOf(prices, position.debtToken),
    10n ** BigInt(decimalsOf(market, position.debtToken)),
  );
  const liquidatableDebt = mulDivFloor(debtValue, BigInt(position.closeFactorBps), 10_000n);
  return mulDivFloor(liquidatableDebt, BigInt(position.liqBonusBps), 10_000n);
}

/** expectedLoss = loss(now) + lambda * loss(stress), all in usd8. */
function expectedLossOf(
  position: PositionSnapshot,
  debtRaw: bigint,
  prices: PriceMap,
  market: OptimizerMarket,
  params: OptimizerParams,
): bigint {
  const lossNow = lossIfLiquidated(position, debtRaw, prices, market, 10_000);
  const lossStress = lossIfLiquidated(position, debtRaw, prices, market, 10_000 - params.stressBps);
  return lossNow + mulDivFloor(lossStress, BigInt(params.lambdaBps), 10_000n);
}

function repayAmountForGoal(
  position: PositionSnapshot,
  prices: PriceMap,
  market: OptimizerMarket,
  params: OptimizerParams,
  goalWad: bigint,
  multiplierBps: number,
): bigint {
  const currentDebtUsd8 = debtUsd8(position, prices, market);
  const targetDebtUsd8 = maxDebtUsd8(position, prices, market, goalWad, multiplierBps);
  if (targetDebtUsd8 >= currentDebtUsd8) return 0n;
  const usd8 = roundUpTo(currentDebtUsd8 - targetDebtUsd8, params.centUsd8);
  return tokenCeil(
    usd8,
    decimalsOf(market, position.debtToken),
    priceOf(prices, position.debtToken),
  );
}

export function candidateRepayLevels(
  position: PositionSnapshot,
  prices: PriceSnapshot[],
  overrides: Partial<OptimizerParams> = {},
  market: OptimizerMarket = {
    reserveToken: position.debtToken,
    lendingSim: '0x0000000000000000000000000000000000000000',
    tokenDecimals: {
      [position.collateralToken]: 18,
      [position.debtToken]: 6,
    } as Record<Address, number>,
    now: 0n,
  },
): RepayLevel[] {
  const params = resolveParams(overrides);
  const priceMap = buildPriceMap(prices);
  const definitions: { name: LevelName; goalWad: bigint; multiplierBps: number }[] = [
    { name: 'none', goalWad: 1n, multiplierBps: 10_000 },
    { name: 'safe-now', goalWad: params.hfSafeEpsWad, multiplierBps: 10_000 },
    { name: 'safe-stress', goalWad: params.hfSafeEpsWad, multiplierBps: 10_000 - params.stressBps },
    { name: 'target', goalWad: params.hfTargetWad, multiplierBps: 10_000 },
  ];
  const seen = new Set<bigint>();
  const levels: RepayLevel[] = [];
  for (const definition of definitions) {
    const amount =
      definition.name === 'none'
        ? 0n
        : repayAmountForGoal(
            position,
            priceMap,
            market,
            params,
            definition.goalWad,
            definition.multiplierBps,
          );
    if (amount > position.debt || seen.has(amount)) continue;
    seen.add(amount);
    const debtAfter = position.debt - amount;
    levels.push({
      name: definition.name,
      amount,
      spendUsd8: usd8Ceil(amount, decimalsOf(market, position.debtToken), priceOf(priceMap, position.debtToken)),
      hfAfterWad: hfAt(position, debtAfter, priceMap, market, 10_000),
      hfStressAfterWad: hfAt(position, debtAfter, priceMap, market, 10_000 - params.stressBps),
      expectedLossUsd8: expectedLossOf(position, debtAfter, priceMap, market, params),
    });
  }
  return levels.sort((left, right) => (left.amount < right.amount ? -1 : left.amount > right.amount ? 1 : 0));
}

export function expectedLossUsd8(
  position: PositionSnapshot,
  amount: bigint,
  prices: PriceSnapshot[],
  overrides: Partial<OptimizerParams> = {},
  market?: OptimizerMarket,
): bigint {
  if (amount < 0n || amount > position.debt) throw new RangeError(`repay amount out of range for pool ${position.poolId}`);
  const params = resolveParams(overrides);
  const resolvedMarket =
    market ??
    ({
      reserveToken: position.debtToken,
      lendingSim: '0x0000000000000000000000000000000000000000',
      tokenDecimals: {
        [position.collateralToken]: 18,
        [position.debtToken]: 6,
      } as Record<Address, number>,
      now: 0n,
    } satisfies OptimizerMarket);
  return expectedLossOf(
    position,
    position.debt - amount,
    buildPriceMap(prices),
    resolvedMarket,
    params,
  );
}

function spendableUsd8(mandate: Mandate, vault: VaultSnapshot): bigint {
  const remaining = mandate.maxTotalSpendUsd > vault.spentUsd8 ? mandate.maxTotalSpendUsd - vault.spentUsd8 : 0n;
  const reserve = vault.liquidReserveUsd8 > mandate.minLiquidReserveUsd
    ? vault.liquidReserveUsd8 - mandate.minLiquidReserveUsd
    : 0n;
  return remaining < reserve ? remaining : reserve;
}

function roundToNearest(value: bigint, unit: bigint): bigint {
  return ((value + unit / 2n) / unit) * unit;
}

function makePlanId(plan: Omit<Plan, 'planId'>): `0x${string}` {
  return keccak256(stringToHex(canonicalJson(plan)));
}

export function optimizeRescue(input: OptimizerInput): Plan {
  const params = resolveParams(input.params);
  const prices = buildPriceMap(input.prices);
  const positions = [...input.positions].sort((left, right) => left.poolId - right.poolId);
  if (positions.length > 5) throw new RangeError('optimizer supports at most 5 positions');
  const poolIds = new Set<number>();
  for (const position of positions) {
    if (poolIds.has(position.poolId)) throw new Error(`duplicate poolId ${position.poolId}`);
    poolIds.add(position.poolId);
    if (position.debtToken !== input.market.reserveToken) {
      throw new Error('P0 optimizer only plans reserve-token (mUSDC) repays');
    }
  }

  const spendable = spendableUsd8(input.mandate, input.vault);
  const levelsByPool = positions.map((position) => ({
    position,
    levels: candidateRepayLevels(position, input.prices, params, input.market),
  }));

  let best:
    | { levels: RepayLevel[]; loss: bigint; spend: bigint; key: [bigint, bigint, string] }
    | undefined;
  const visit = (index: number, chosen: RepayLevel[], loss: bigint, spend: bigint): void => {
    if (index === levelsByPool.length) {
      if (spend > spendable) return;
      const key: [bigint, bigint, string] = [
        roundToNearest(loss, 100n),
        roundToNearest(spend, params.centUsd8),
        chosen.map((level) => level.name).join('\u0000'),
      ];
      if (
        best === undefined ||
        key[0] < best.key[0] ||
        (key[0] === best.key[0] && key[1] < best.key[1]) ||
        (key[0] === best.key[0] && key[1] === best.key[1] && key[2] < best.key[2])
      ) {
        best = { levels: [...chosen], loss, spend, key };
      }
      return;
    }
    const entry = levelsByPool[index];
    if (entry === undefined) return;
    for (const level of entry.levels) {
      chosen.push(level);
      visit(index + 1, chosen, loss + level.expectedLossUsd8, spend + level.spendUsd8);
      chosen.pop();
    }
  };
  visit(0, [], 0n, 0n);
  if (best === undefined) throw new Error('optimizer found no feasible combination; unreachable with the none level');
  const chosen = best;

  const improves = (positionLevels: RepayLevel[]): RepayLevel | undefined => {
    const none = positionLevels.find((level) => level.name === 'none');
    if (none === undefined) return undefined;
    return positionLevels.find(
      (level) => level.name !== 'none' && level.expectedLossUsd8 < none.expectedLossUsd8,
    );
  };
  const usefulLevels = levelsByPool.flatMap(({ levels }) => {
    const none = levels.find((level) => level.name === 'none');
    if (none === undefined) return [];
    return levels.filter((level) => level.name !== 'none' && level.expectedLossUsd8 < none.expectedLossUsd8);
  });
  const anyImprovement = usefulLevels.length > 0;
  const feasibleImprovement = usefulLevels.some((level) => level.spendUsd8 <= spendable);
  const cheapestUseful = usefulLevels.reduce<bigint | undefined>(
    (minimum, level) => (minimum === undefined || level.spendUsd8 < minimum ? level.spendUsd8 : minimum),
    undefined,
  );

  const unsavedPools: number[] = [];
  const selectedActions: { position: PositionSnapshot; level: RepayLevel; none: RepayLevel }[] = [];
  levelsByPool.forEach(({ position, levels }, index) => {
    const level = chosen.levels[index];
    const none = levels.find((candidate) => candidate.name === 'none');
    if (level === undefined || none === undefined) throw new Error(`missing chosen level for pool ${position.poolId}`);
    if (level.name === 'none' && improves(levels) !== undefined) unsavedPools.push(position.poolId);
    if (level.amount > 0n) selectedActions.push({ position, level, none });
  });

  const haltReason =
    selectedActions.length === 0 && anyImprovement && !feasibleImprovement
      ? {
          kind: 'BUDGET_INSUFFICIENT' as const,
          neededUsd8: cheapestUseful ?? 0n,
          availableUsd8: spendable,
        }
      : undefined;

  const actions = selectedActions.map(({ position, level, none }, actionIndex): { action: Action; rationale: Plan['actions'][number]['rationale'] } => ({
    action: {
      mandateId: input.mandate.id,
      nonce: input.vault.actionNonce + BigInt(actionIndex),
      actionType: 'REPAY',
      target: input.market.lendingSim,
      poolId: position.poolId,
      tokenIn: input.market.reserveToken,
      tokenOut: null,
      amount: level.amount,
      minAmountOut: 0n,
      quotedPriceUsd8: priceOf(prices, input.market.reserveToken),
      deadline: input.market.now + 120n,
    },
    rationale: {
      poolId: position.poolId,
      hfBefore: none.hfAfterWad,
      hfAfterExpected: level.hfAfterWad,
      lossBeforeUsd8: none.expectedLossUsd8,
      lossAfterUsd8: level.expectedLossUsd8,
      spendUsd8: level.spendUsd8,
      levelName: level.name,
    },
  }));

  const partialPlan: Omit<Plan, 'planId'> = {
    version: input.market.version ?? 1,
    basedOnBlock: input.vault.blockNumber,
    actions: actions.map((entry, index) => ({ index, ...entry })),
    totalSpendUsd8: actions.reduce((sum, { rationale }) => sum + rationale.spendUsd8, 0n),
    expectedLossUsd8: chosen.loss,
    unsavedPools: [...new Set(unsavedPools)].sort((a, b) => a - b),
    ...(haltReason === undefined ? {} : { haltReason }),
  };
  return { planId: makePlanId(partialPlan), ...partialPlan };
}

export function localThresholdBaseline(
  input: OptimizerInput,
  triggerHfWad: bigint = 1_050_000_000_000_000_000n,
): BaselineResult {
  const params = resolveParams(input.params);
  const prices = buildPriceMap(input.prices);
  const spendable = spendableUsd8(input.mandate, input.vault);
  let remaining = spendable;
  const allocations: BaselineAllocation[] = [];
  const ordered = [...input.positions].sort((left, right) => {
    const leftHf = hfAt(left, left.debt, prices, input.market, 10_000);
    const rightHf = hfAt(right, right.debt, prices, input.market, 10_000);
    return leftHf < rightHf ? -1 : leftHf > rightHf ? 1 : left.poolId - right.poolId;
  });
  const selected = new Map<number, { amount: bigint; levelName: LevelName | 'partial-target'; loss: bigint }>();

  for (const position of ordered) {
    const levels = candidateRepayLevels(position, input.prices, params, input.market);
    const none = levels.find((level) => level.name === 'none');
    const target = levels.find((level) => level.name === 'target');
    if (none === undefined) continue;
    const hfNow = none.hfAfterWad;
    let amount = 0n;
    let levelName: LevelName | 'partial-target' = 'none';
    if (hfNow < triggerHfWad && target !== undefined) {
      if (target.spendUsd8 <= remaining) {
        amount = target.amount;
        levelName = 'target';
      } else if (remaining > 0n) {
        const raw = mulDivFloor(
          remaining,
          10n ** BigInt(decimalsOf(input.market, position.debtToken)),
          priceOf(prices, position.debtToken),
        );
        amount = raw < target.amount ? raw : target.amount;
        levelName = 'partial-target';
      }
      const spend = usd8Ceil(
        amount,
        decimalsOf(input.market, position.debtToken),
        priceOf(prices, position.debtToken),
      );
      remaining -= spend > remaining ? remaining : spend;
    }
    selected.set(position.poolId, {
      amount,
      levelName,
      loss: expectedLossUsd8(position, amount, input.prices, params, input.market),
    });
  }

  for (const position of [...input.positions].sort((left, right) => left.poolId - right.poolId)) {
    const choice = selected.get(position.poolId);
    if (choice === undefined) continue;
    allocations.push({
      poolId: position.poolId,
      amount: choice.amount,
      levelName: choice.levelName,
      spendUsd8: usd8Ceil(
        choice.amount,
        decimalsOf(input.market, position.debtToken),
        priceOf(prices, position.debtToken),
      ),
      expectedLossUsd8: choice.loss,
    });
  }

  const unsavedPools = allocations
    .filter((allocation) => {
      const position = input.positions.find((candidate) => candidate.poolId === allocation.poolId);
      if (position === undefined || allocation.levelName !== 'none') return false;
      const levels = candidateRepayLevels(position, input.prices, params, input.market);
      const none = levels.find((level) => level.name === 'none');
      return none !== undefined && levels.some((level) => level.name !== 'none' && level.expectedLossUsd8 < none.expectedLossUsd8);
    })
    .map(({ poolId }) => poolId);

  return {
    allocations,
    totalSpendUsd8: allocations.reduce((sum, allocation) => sum + allocation.spendUsd8, 0n),
    expectedLossUsd8: allocations.reduce((sum, allocation) => sum + allocation.expectedLossUsd8, 0n),
    unsavedPools,
  };
}
