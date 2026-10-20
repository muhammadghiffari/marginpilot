import { MAX_UINT256, mulDivFloor } from './valuation.js';

export interface HealthFactorArgs {
  collateral: bigint;
  collateralDecimals: number;
  collateralPriceUsd8: bigint;
  ltBps: number;
  debt: bigint;
  debtDecimals: number;
  debtPriceUsd8: bigint;
}

/** HF in wad, mirroring LendingSim.healthFactor (integer truncation included). */
export function healthFactorWad(args: HealthFactorArgs): bigint {
  const { collateral, collateralDecimals, collateralPriceUsd8, ltBps, debt, debtDecimals, debtPriceUsd8 } =
    args;
  if (debt === 0n) return MAX_UINT256;
  if (debt < 0n) throw new RangeError('debt must be non-negative');
  if (ltBps < 0 || ltBps > 10_000) throw new RangeError(`ltBps out of range: ${ltBps}`);
  const collateralUsd8 = mulDivFloor(collateral, collateralPriceUsd8, 10n ** BigInt(collateralDecimals));
  const debtUsd8 = mulDivFloor(debt, debtPriceUsd8, 10n ** BigInt(debtDecimals));
  if (debtUsd8 === 0n) throw new RangeError('debt rounds to zero usd8; refusing an undefined health factor');
  return mulDivFloor(collateralUsd8 * BigInt(ltBps), 10n ** 18n, debtUsd8 * 10_000n);
}

export function isLiquidatable(healthFactor: bigint): boolean {
  return healthFactor < 10n ** 18n;
}
