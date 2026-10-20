import type { Address } from './types.js';

export const MAX_UINT256 = (1n << 256n) - 1n;

function assertNonNegative(value: bigint, label: string): void {
  if (value < 0n) throw new RangeError(`${label} must be non-negative`);
}

export function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError(`decimals must be an integer in [0, 255], got ${decimals}`);
  }
}

/** floor(a * b / denominator) with no intermediate precision loss. */
export function mulDivFloor(a: bigint, b: bigint, denominator: bigint): bigint {
  assertNonNegative(a, 'a');
  assertNonNegative(b, 'b');
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  return (a * b) / denominator;
}

/** ceil(a * b / denominator) — the spend-accounting rounding direction. */
export function mulDivCeil(a: bigint, b: bigint, denominator: bigint): bigint {
  assertNonNegative(a, 'a');
  assertNonNegative(b, 'b');
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  const product = a * b;
  return product === 0n ? 0n : (product + denominator - 1n) / denominator;
}

/** USD value (usd8) of a raw token amount at an oracle price, rounded up. */
export function usd8Ceil(amount: bigint, decimals: number, priceUsd8: bigint): bigint {
  assertDecimals(decimals);
  assertNonNegative(priceUsd8, 'priceUsd8');
  return mulDivCeil(amount, priceUsd8, 10n ** BigInt(decimals));
}

/** Raw token units equivalent to a usd8 amount, rounded up. */
export function tokenCeil(usd8: bigint, decimals: number, priceUsd8: bigint): bigint {
  assertDecimals(decimals);
  assertNonNegative(usd8, 'usd8');
  if (priceUsd8 <= 0n) throw new RangeError('priceUsd8 must be positive');
  return mulDivCeil(usd8, 10n ** BigInt(decimals), priceUsd8);
}

export type { Address };
