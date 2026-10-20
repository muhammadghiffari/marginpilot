import { z } from 'zod';

import type {
  Action,
  Address,
  AuditEntry,
  ErrorName,
  HaltReason,
  Hex,
  LedgerEntry,
  Mandate,
  MandateDraft,
  Plan,
  PositionSnapshot,
  PriceSnapshot,
  RationaleFacts,
  VaultSnapshot,
} from './types.js';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);

const UINT8_MAX = 255n;
const UINT32_MAX = 4_294_967_295n;
const UINT64_MAX = 18_446_744_073_709_551_615n;
const UINT128_MAX = 340_282_366_920_938_463_463_374_607_431_768_211_455n;
const UINT256_MAX = (1n << 256n) - 1n;

const DecimalStringSchema = z.string().regex(/^(0|[1-9]\d*)$/, 'expected an unsigned decimal string');

function uintSchema(max: bigint): z.ZodType<bigint, z.ZodTypeDef, unknown> {
  return DecimalStringSchema.transform((value) => BigInt(value)).refine(
    (value) => value <= max,
    `must be <= ${max.toString()}`,
  );
}

export const AddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'expected a 20-byte hex address')
  .transform((value): Address => value as Address);

export const HexSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'expected a 32-byte hex value')
  .transform((value): Hex => value as Hex);

export const Uint256Schema = uintSchema(UINT256_MAX);
export const ErrorNameSchema = z.enum([
  'NotOwner',
  'NotExecutor',
  'Paused',
  'MandateInactive',
  'MandateExpired',
  'StaleAction',
  'DeadlineExpired',
  'ZeroAmount',
  'ActionNotAllowed',
  'BorrowForbidden',
  'TargetNotAllowed',
  'AssetLocked',
  'StalePrice',
  'PriceDeviation',
  'PerActionCapExceeded',
  'BudgetExceeded',
  'SlippageExceeded',
  'PostConditionFailed',
  'BadSignature',
  'BadNonce',
  'SignatureExpired',
]) satisfies z.ZodType<ErrorName, z.ZodTypeDef, unknown>;

const bps = z.number().int().min(0).max(10_000);
const uint8Number = z.number().int().min(0).max(Number(UINT8_MAX));
const uint32Number = z.number().int().min(0).max(Number(UINT32_MAX));

export const ActionTypeSchema = z.enum(['REPAY', 'SUPPLY_COLLATERAL', 'SWAP', 'BORROW']);

export const MandateSchema = z
  .object({
    id: uintSchema(UINT64_MAX),
    validFrom: uintSchema(UINT64_MAX),
    validUntil: uintSchema(UINT64_MAX),
    maxTotalSpendUsd: uintSchema(UINT128_MAX),
    maxPerActionUsd: uintSchema(UINT128_MAX),
    minLiquidReserveUsd: uintSchema(UINT128_MAX),
    maxSlippageBps: bps,
    maxPriceAgeSec: uint32Number,
    maxPriceDeviationBps: bps,
    allowedActions: uint8Number,
    allowBorrow: z.boolean(),
    allowedTargets: z.array(AddressSchema),
    lockedTokens: z.array(AddressSchema),
  })
  .strict() satisfies z.ZodType<Mandate, z.ZodTypeDef, unknown>;

export const MandateDraftSchema = z
  .object({
    mandate: MandateSchema.omit({ id: true }),
    humanSummary: z.string(),
    clarifications: z.array(z.object({ field: z.string(), question: z.string() }).strict()),
    assumptions: z.array(
      z
        .object({
          field: z.string(),
          value: z.string(),
          reason: z.enum(['default', 'inferred']),
        })
        .strict(),
    ),
  })
  .strict() satisfies z.ZodType<MandateDraft, z.ZodTypeDef, unknown>;

export const ActionSchema = z
  .object({
    mandateId: uintSchema(UINT64_MAX),
    nonce: uintSchema(UINT64_MAX),
    actionType: ActionTypeSchema,
    target: AddressSchema,
    poolId: uint8Number,
    tokenIn: AddressSchema,
    tokenOut: AddressSchema.nullable(),
    amount: Uint256Schema,
    minAmountOut: Uint256Schema,
    quotedPriceUsd8: Uint256Schema,
    deadline: uintSchema(UINT64_MAX),
  })
  .strict() satisfies z.ZodType<Action, z.ZodTypeDef, unknown>;

export const PositionSnapshotSchema = z
  .object({
    poolId: z.union([z.literal(0), z.literal(1)]),
    collateralToken: AddressSchema,
    debtToken: AddressSchema,
    collateral: Uint256Schema,
    debt: Uint256Schema,
    healthFactor: Uint256Schema,
    ltBps: bps,
    liqBonusBps: bps,
    closeFactorBps: bps,
  })
  .strict() satisfies z.ZodType<PositionSnapshot, z.ZodTypeDef, unknown>;

export const PriceSnapshotSchema = z
  .object({
    token: AddressSchema,
    priceUsd8: Uint256Schema,
    updatedAt: uintSchema(UINT64_MAX),
  })
  .strict() satisfies z.ZodType<PriceSnapshot, z.ZodTypeDef, unknown>;

export const VaultSnapshotSchema = z
  .object({
    blockNumber: uintSchema(UINT64_MAX),
    blockTimestamp: uintSchema(UINT64_MAX),
    paused: z.boolean(),
    activeMandateId: uintSchema(UINT64_MAX),
    actionNonce: uintSchema(UINT64_MAX),
    spentUsd8: Uint256Schema,
    liquidReserveUsd8: Uint256Schema,
    balances: z
      .record(AddressSchema, Uint256Schema)
      .transform((value): Record<Address, bigint> => value as Record<Address, bigint>),
  })
  .strict() satisfies z.ZodType<VaultSnapshot, z.ZodTypeDef, unknown>;

export const RationaleFactsSchema = z
  .object({
    poolId: uint8Number,
    hfBefore: Uint256Schema,
    hfAfterExpected: Uint256Schema,
    lossBeforeUsd8: Uint256Schema,
    lossAfterUsd8: Uint256Schema,
    spendUsd8: Uint256Schema,
    levelName: z.string(),
  })
  .strict() satisfies z.ZodType<RationaleFacts, z.ZodTypeDef, unknown>;

export const HaltReasonSchema: z.ZodType<HaltReason, z.ZodTypeDef, unknown> = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('BUDGET_INSUFFICIENT'), neededUsd8: Uint256Schema, availableUsd8: Uint256Schema })
    .strict(),
  z.object({ kind: z.literal('STALE_OR_CONFLICTING_DATA'), detail: z.string() }).strict(),
  z.object({ kind: z.literal('MANDATE_INVALID'), error: ErrorNameSchema }).strict(),
  z.object({ kind: z.literal('PAUSED') }).strict(),
  z.object({ kind: z.literal('NEEDS_OWNER_DECISION'), detail: z.string() }).strict(),
]);

export const PlanSchema = z
  .object({
    planId: z.string().min(1),
    version: z.number().int().min(0),
    basedOnBlock: uintSchema(UINT64_MAX),
    actions: z.array(
      z.object({ index: z.number().int().min(0), action: ActionSchema, rationale: RationaleFactsSchema }).strict(),
    ),
    totalSpendUsd8: Uint256Schema,
    expectedLossUsd8: Uint256Schema,
    unsavedPools: z.array(uint8Number),
    haltReason: HaltReasonSchema.optional(),
  })
  .strict() satisfies z.ZodType<Plan, z.ZodTypeDef, unknown>;

export const LedgerEntrySchema = z
  .object({
    runId: z.string().min(1),
    actionIndex: z.number().int().min(0),
    txHash: HexSchema.optional(),
    mandateId: uintSchema(UINT64_MAX),
    spendUsd8: Uint256Schema,
    gasWei: Uint256Schema,
    gasUsd8: Uint256Schema.nullable(),
    status: z.enum(['mined', 'reverted', 'unknown']),
    error: ErrorNameSchema.optional(),
    ts: z.number().int().min(0),
  })
  .strict() satisfies z.ZodType<LedgerEntry, z.ZodTypeDef, unknown>;

export const AuditEntrySchema = z
  .object({
    seq: z.number().int().min(0),
    ts: z.number().int().min(0),
    runId: z.string(),
    kind: z.string(),
    data: JsonValueSchema,
    prevHash: HexSchema,
    hash: HexSchema,
  })
  .strict() satisfies z.ZodType<AuditEntry, z.ZodTypeDef, unknown>;

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Encode bigint values as decimal strings; reject values JSON cannot represent safely. */
export function encodeJson(value: unknown): JsonValue {
  const ancestors = new Set<object>();
  const walk = (current: unknown): JsonValue => {
    if (current === null) return null;
    if (typeof current === 'string' || typeof current === 'boolean') return current;
    if (typeof current === 'bigint') return current.toString(10);
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new TypeError('non-finite number is not JSON-safe');
      return current;
    }
    if (typeof current !== 'object') throw new TypeError(`unsupported value type: ${typeof current}`);
    if (ancestors.has(current)) throw new TypeError('cyclic value is not JSON-safe');
    ancestors.add(current);
    try {
      if (Array.isArray(current)) return current.map(walk);
      if (!isPlainObject(current)) throw new TypeError('only plain objects are JSON-safe');
      return Object.fromEntries(Object.entries(current).map(([key, entry]) => [key, walk(entry)]));
    } finally {
      ancestors.delete(current);
    }
  };
  return walk(value);
}

/** Validate a decoded boundary value with its zod schema (bigint strings become bigint). */
export function parseJson<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(value[key] as JsonValue)]),
    );
  }
  return value;
}

/** Deterministic JSON with lexicographically sorted keys, for hash chaining. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(encodeJson(value)));
}
