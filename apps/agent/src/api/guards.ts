import type { Mandate } from '@marginpilot/core';

/** Minimum gap between two uses of a shared, chain-touching endpoint (global, not per IP). */
export class Cooldown {
  private last = 0;
  constructor(private readonly ms: number, private readonly now: () => number = Date.now) {}

  /** Milliseconds still to wait; 0 when the action may proceed. */
  remainingMs(): number {
    if (this.ms <= 0 || this.last === 0) return 0;
    return Math.max(0, this.last + this.ms - this.now());
  }

  mark(): void {
    this.last = this.now();
  }
}

/**
 * Browsers always send Origin on cross-origin and on same-origin POST. A request is allowed
 * when it has no Origin (curl, server-to-server), the Origin host equals the Host header, or the
 * Origin is listed explicitly. There is no CORS header on any response.
 */
export function originAllowed(
  origin: string | undefined,
  host: string | undefined,
  allowed: ReadonlySet<string>,
): boolean {
  if (origin === undefined) return true;
  if (allowed.has(origin)) return true;
  try {
    return host !== undefined && new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const USD8 = 100_000_000n;
export const DEMO_MAX_TOTAL_USD8 = 260n * USD8;
const MAX_WINDOW_SEC = 7n * 24n * 3_600n;
const SWAP_BIT = 4;
const MAX_SLIPPAGE_BPS = 300;

/**
 * Limits for a mandate that the SERVER signs with the demo owner key on a public chain.
 * Anything a visitor submits outside this envelope is refused before signing. The vault still
 * enforces whatever is signed, so the envelope is what keeps the public demo owner's authority small.
 */
export function demoEnvelopeViolations(mandate: Mandate, allowedTargets: readonly string[]): string[] {
  const violations: string[] = [];
  if (mandate.maxTotalSpendUsd > DEMO_MAX_TOTAL_USD8) violations.push('maxTotalSpendUsd above $260');
  if (mandate.maxPerActionUsd > mandate.maxTotalSpendUsd) violations.push('maxPerActionUsd above maxTotalSpendUsd');
  if (mandate.allowBorrow) violations.push('allowBorrow must be false');
  if ((mandate.allowedActions & SWAP_BIT) !== 0) violations.push('SWAP is not allowed');
  if (mandate.allowedActions === 0 || mandate.allowedActions > 7) violations.push('allowedActions out of range');
  if (mandate.validUntil <= mandate.validFrom) violations.push('validUntil must be after validFrom');
  if (mandate.validUntil - mandate.validFrom > MAX_WINDOW_SEC) violations.push('validity window above 7 days');
  if (mandate.maxSlippageBps > MAX_SLIPPAGE_BPS) violations.push('maxSlippageBps above 300');
  const known = new Set(allowedTargets.map((target) => target.toLowerCase()));
  if (mandate.allowedTargets.length === 0) violations.push('allowedTargets is empty');
  for (const target of mandate.allowedTargets) {
    if (!known.has(target.toLowerCase())) violations.push(`target ${target} is not a deployed contract`);
  }
  return violations;
}
