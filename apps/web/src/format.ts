const USD8 = 100_000_000n;
const WAD = 1_000_000_000_000_000_000n;

export function formatUsd8(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const cents = (absolute + 500_000n) / 1_000_000n;
  const dollars = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (cents % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}$${dollars}.${fraction}`;
}

export function formatHealth(healthFactor: bigint): string {
  if (healthFactor > 100n * WAD) return '∞';
  const rounded = (healthFactor * 1_000n + WAD / 2n) / WAD;
  return `${rounded / 1_000n}.${(rounded % 1_000n).toString().padStart(3, '0')}`;
}

export function healthBand(healthFactor: bigint): 'risk' | 'caution' | 'safe' {
  if (healthFactor < WAD) return 'risk';
  if (healthFactor < 1_100_000_000_000_000_000n) return 'caution';
  return 'safe';
}

export function budgetUsedPercent(spentUsd8: bigint, capUsd8: bigint): number {
  if (capUsd8 <= 0n) return 0;
  const bps = (spentUsd8 * 10_000n) / capUsd8;
  const clamped = bps < 0n ? 0n : bps > 10_000n ? 10_000n : bps;
  return Number(clamped) / 100;
}

export function remainingBudgetUsd8(capUsd8: bigint, spentUsd8: bigint): bigint {
  return capUsd8 > spentUsd8 ? capUsd8 - spentUsd8 : 0n;
}

export function priceUsd8(value: bigint): string { return formatUsd8(value); }

export { USD8 };
