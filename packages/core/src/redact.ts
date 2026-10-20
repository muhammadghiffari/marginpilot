export const REDACTED = '[REDACTED]';
export const REDACTED_KEY = '[REDACTED_KEY]';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Extract secret-looking env values without ever reading a .env file. */
export function secretValuesFromEnv(env: Record<string, string | undefined>): string[] {
  const values = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    if (!/_KEY$|^(MNEMONIC|SECRET|PRIVATE_KEY)$/i.test(key)) continue;
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length >= 4) values.add(trimmed);
  }
  return [...values].sort((left, right) => right.length - left.length);
}

/** Redact key-shaped strings, API keys, PEM blocks, Authorization values and known secrets. */
export function redactText(text: string, secrets: string[] = []): string {
  let output = text;
  for (const secret of [...secrets].sort((left, right) => right.length - left.length)) {
    if (secret.length < 4) continue;
    output = output.replace(new RegExp(escapeRegExp(secret), 'g'), REDACTED);
  }
  output = output.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED_KEY);
  output = output.replace(/0x[0-9a-fA-F]{64}/g, REDACTED_KEY);
  output = output.replace(/sk-[A-Za-z0-9_-]{20,}/g, REDACTED_KEY);
  output = output.replace(/AKIA[0-9A-Z]{16}/g, REDACTED_KEY);
  output = output.replace(
    /(authorization\s*[:=]\s*)(?:bearer\s+)?("[^"]*"|'[^']*'|[^\s,;]+)/gi,
    `$1${REDACTED}`,
  );
  return output;
}

/** Deep-redact a log payload. Plain objects/arrays preserve shape; bigint values stay bigint. */
export function redactValue(value: unknown, secrets: string[] = []): unknown {
  if (typeof value === 'string') return redactText(value, secrets);
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, secrets));
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          key.toLowerCase() === 'authorization' ? REDACTED : redactValue(entry, secrets),
        ]),
      );
    }
    return redactText(String(value), secrets);
  }
  return value;
}

