import { concat, keccak256, stringToHex } from 'viem';

import { redactValue } from './redact.js';
import { canonicalJson, encodeJson, type JsonValue } from './schemas.js';
import type { AuditEntry, Hex } from './types.js';

export const ZERO_HASH: Hex = `0x${'0'.repeat(64)}`;

export interface AuditLogOptions {
  secrets?: string[];
  now?: () => number;
}

function hashEntry(prevHash: Hex, payload: Record<string, unknown>): Hex {
  return keccak256(concat([prevHash, stringToHex(canonicalJson(payload))]));
}

/** Append-only hash chain: keccak256(prevHash || canonicalJson({seq,ts,runId,kind,data})). */
export class AuditLog {
  readonly entries: AuditEntry[] = [];
  private readonly secrets: string[];
  private readonly now: () => number;

  constructor(
    private readonly runId: string,
    options: AuditLogOptions = {},
  ) {
    this.secrets = options.secrets ?? [];
    this.now = options.now ?? (() => Date.now());
  }

  append(kind: string, data: unknown, ts: number = this.now()): AuditEntry {
    const seq = this.entries.length;
    const payload = {
      seq,
      ts,
      runId: this.runId,
      kind,
      data: encodeJson(redactValue(data, this.secrets)),
    };
    const prevHash = this.entries[this.entries.length - 1]?.hash ?? ZERO_HASH;
    const entry: AuditEntry = { ...payload, prevHash, hash: hashEntry(prevHash, payload) };
    this.entries.push(entry);
    return entry;
  }

  toJSONL(): string {
    return this.entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  }
}

export function verifyAuditChain(entries: readonly AuditEntry[]): boolean {
  let previous: Hex = ZERO_HASH;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined) return false;
    if (entry.seq !== index) return false;
    if (entry.prevHash.toLowerCase() !== previous.toLowerCase()) return false;
    const payload: Record<string, unknown> = {
      seq: entry.seq,
      ts: entry.ts,
      runId: entry.runId,
      kind: entry.kind,
      data: entry.data as JsonValue,
    };
    if (hashEntry(entry.prevHash, payload).toLowerCase() !== entry.hash.toLowerCase()) return false;
    previous = entry.hash;
  }
  return true;
}
