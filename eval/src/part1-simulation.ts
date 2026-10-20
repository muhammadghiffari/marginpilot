import {
  DEFAULT_OPTIMIZER_PARAMS,
  healthFactorWad,
  localThresholdBaseline,
  mulDivFloor,
  optimizeRescue,
  type Address,
  type Mandate,
  type OptimizerInput,
  type PositionSnapshot,
  type PriceSnapshot,
  type VaultSnapshot,
} from '@marginpilot/core';

const USDC: Address = '0x00000000000000000000000000000000000000a1';
const WETH: Address = '0x00000000000000000000000000000000000000a2';
const WSTETH: Address = '0x00000000000000000000000000000000000000a3';
const LENDING: Address = '0x00000000000000000000000000000000000000b1';
const NOW = 1_700_000_000n;
const USD8 = 100_000_000n;
const WAD = 1_000_000_000_000_000_000n;

export interface AllocationOutcome {
  spentUsd8: bigint;
  expectedLossUsd8: bigint;
  realizedLossUsd8: bigint;
  safePools: number;
  allocations: { poolId: number; amount: bigint }[];
}

export interface Part1Case {
  seed: number;
  simulated: true;
  stressRealized: boolean;
  spendableUsd8: bigint;
  budgetUsd8: bigint;
  reserveUsd8: bigint;
  minReserveUsd8: bigint;
  positions: {
    poolId: number; hfBeforeWad: bigint; initialShockBps: number;
    preShockPriceUsd8: bigint; postShockPriceUsd8: bigint;
  }[];
  a: AllocationOutcome;
  b: AllocationOutcome;
}

class SeededRandom {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0; }
  private next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }
  int(min: number, max: number): number { return min + (this.next() % (max - min + 1)); }
}

function makeCase(seed: number): {
  input: OptimizerInput; stressRealized: boolean; spendableUsd8: bigint;
  shocks: { token: Address; initialShockBps: number; preShockPriceUsd8: bigint; postShockPriceUsd8: bigint }[];
} {
  const random = new SeededRandom(seed);
  const shocks = ([WETH, WSTETH] as const).map((token) => {
    const preShockPriceUsd8 = BigInt(random.int(1_800, 3_000)) * USD8;
    const initialShockBps = random.int(500, 2_500);
    return { token, preShockPriceUsd8, initialShockBps,
      postShockPriceUsd8: mulDivFloor(preShockPriceUsd8, BigInt(10_000 - initialShockBps), 10_000n) };
  });
  const prices: PriceSnapshot[] = [
    { token: USDC, priceUsd8: USD8, updatedAt: NOW },
    ...shocks.map(({ token, postShockPriceUsd8 }) => ({ token, priceUsd8: postShockPriceUsd8, updatedAt: NOW })),
  ];
  const positions: PositionSnapshot[] = ([WETH, WSTETH] as const).map((token, index) => {
    const collateral = BigInt(random.int(8, 25)) * (WAD / 10n);
    const ltBps = random.int(7_600, 8_500);
    const price = prices.find((entry) => entry.token === token);
    if (!price) throw new Error('missing simulated collateral price');
    const collateralUsd8 = mulDivFloor(collateral, price.priceUsd8, WAD);
    const debtUsd8 = mulDivFloor(collateralUsd8 * BigInt(ltBps), 1_000n, BigInt(random.int(850, 1_220)) * 10_000n);
    const debt = debtUsd8 / 100n;
    return {
      poolId: index as 0 | 1, collateralToken: token, debtToken: USDC,
      collateral, debt, healthFactor: healthFactorWad({
        collateral, collateralDecimals: 18, collateralPriceUsd8: price.priceUsd8,
        ltBps, debt, debtDecimals: 6, debtPriceUsd8: USD8,
      }),
      ltBps, liqBonusBps: random.int(400, 900), closeFactorBps: 5_000,
    };
  });
  const budgetUsd8 = BigInt(random.int(50, 350)) * USD8;
  const reserveUsd8 = BigInt(random.int(150, 700)) * USD8;
  const minReserveUsd8 = BigInt(random.int(50, 150)) * USD8;
  const mandate: Mandate = {
    id: 1n, validFrom: NOW - 1n, validUntil: NOW + 86_400n,
    maxTotalSpendUsd: budgetUsd8, maxPerActionUsd: budgetUsd8,
    minLiquidReserveUsd: minReserveUsd8, maxSlippageBps: 100,
    maxPriceAgeSec: 600, maxPriceDeviationBps: 300, allowedActions: 3,
    allowBorrow: false, allowedTargets: [LENDING], lockedTokens: [WETH],
  };
  const vault: VaultSnapshot = {
    blockNumber: 100n, blockTimestamp: NOW, paused: false,
    activeMandateId: 1n, actionNonce: 7n, spentUsd8: 0n,
    liquidReserveUsd8: reserveUsd8, balances: { [USDC]: reserveUsd8 / 100n },
  };
  const available = reserveUsd8 > minReserveUsd8 ? reserveUsd8 - minReserveUsd8 : 0n;
  return {
    input: { positions, prices, mandate, vault, market: {
      reserveToken: USDC, lendingSim: LENDING, now: NOW,
      tokenDecimals: { [USDC]: 6, [WETH]: 18, [WSTETH]: 18 },
    } },
    stressRealized: random.int(0, 9_999) < DEFAULT_OPTIMIZER_PARAMS.lambdaBps,
    spendableUsd8: budgetUsd8 < available ? budgetUsd8 : available,
    shocks,
  };
}

function score(
  input: OptimizerInput,
  allocations: { poolId: number; amount: bigint }[],
  spentUsd8: bigint,
  expectedLossUsd8: bigint,
  stressRealized: boolean,
): AllocationOutcome {
  let realizedLossUsd8 = 0n;
  let safePools = 0;
  for (const position of input.positions) {
    const amount = allocations.find((item) => item.poolId === position.poolId)?.amount ?? 0n;
    const debt = position.debt - amount;
    if (debt < 0n) throw new Error('repay exceeds simulated debt');
    const price = input.prices.find((item) => item.token === position.collateralToken);
    if (!price) throw new Error('missing simulated price');
    const current = {
      collateral: position.collateral,
      collateralDecimals: 18,
      collateralPriceUsd8: price.priceUsd8,
      ltBps: position.ltBps,
      debt,
      debtDecimals: 6,
      debtPriceUsd8: USD8,
    };
    if (healthFactorWad(current) >= DEFAULT_OPTIMIZER_PARAMS.hfSafeEpsWad) safePools += 1;
    const realizedPrice = stressRealized
      ? mulDivFloor(price.priceUsd8, BigInt(10_000 - DEFAULT_OPTIMIZER_PARAMS.stressBps), 10_000n)
      : price.priceUsd8;
    if (healthFactorWad({ ...current, collateralPriceUsd8: realizedPrice }) < WAD) {
      const debtUsd8 = debt * 100n;
      const liquidatable = mulDivFloor(debtUsd8, BigInt(position.closeFactorBps), 10_000n);
      realizedLossUsd8 += mulDivFloor(liquidatable, BigInt(position.liqBonusBps), 10_000n);
    }
  }
  return { spentUsd8, expectedLossUsd8, realizedLossUsd8, safePools, allocations };
}

export function simulatePart1(options: { firstSeed: number; count: number }): Part1Case[] {
  if (!Number.isSafeInteger(options.firstSeed) || options.firstSeed < 1 || options.firstSeed > 0xffff_ffff) {
    throw new RangeError('firstSeed must be a positive uint32');
  }
  if (!Number.isSafeInteger(options.count) || options.count < 1 || options.count > 5_000 || options.firstSeed + options.count - 1 > 0xffff_ffff) {
    throw new RangeError('count must be 1..5000 with seeds in uint32');
  }
  const results: Part1Case[] = [];
  for (let offset = 0; offset < options.count; offset += 1) {
    const seed = options.firstSeed + offset;
    const { input, stressRealized, spendableUsd8, shocks } = makeCase(seed);
    const baseline = localThresholdBaseline(input);
    const plan = optimizeRescue(input);
    const a = score(input, baseline.allocations.map(({ poolId, amount }) => ({ poolId, amount })),
      baseline.totalSpendUsd8, baseline.expectedLossUsd8, stressRealized);
    const b = score(input, plan.actions.map(({ rationale, action }) => ({ poolId: rationale.poolId, amount: action.amount })),
      plan.totalSpendUsd8, plan.expectedLossUsd8, stressRealized);
    if (a.spentUsd8 > spendableUsd8 || b.spentUsd8 > spendableUsd8) {
      throw new Error(`allocator exceeded spendable budget at seed ${seed}`);
    }
    results.push({
      seed, simulated: true, stressRealized, spendableUsd8,
      budgetUsd8: input.mandate.maxTotalSpendUsd,
      reserveUsd8: input.vault.liquidReserveUsd8,
      minReserveUsd8: input.mandate.minLiquidReserveUsd,
      positions: input.positions.map(({ poolId, collateralToken, healthFactor }) => {
        const shock = shocks.find(({ token }) => token === collateralToken);
        if (!shock) throw new Error('missing recorded initial shock');
        return { poolId, hfBeforeWad: healthFactor,
          initialShockBps: shock.initialShockBps,
          preShockPriceUsd8: shock.preShockPriceUsd8,
          postShockPriceUsd8: shock.postShockPriceUsd8 };
      }),
      a, b,
    });
  }
  return results;
}
