import {
  MandateDraftSchema,
  type ActionType,
  type MandateDraft,
  type TokenSymbol,
} from '@marginpilot/core';
import { z } from 'zod';

import type { LlmClient } from '../llm/client.js';
import { COMPILE_SYSTEM_PROMPT, detectInjection, sanitizeUntrusted, wrapUntrusted } from '../prompts.js';
import type { TokenRegistry } from './registry.js';

const USDC_SCALE = 100_000_000n;
const DEFAULT_VALIDITY_SEC = 86_400;
const DEFAULT_SLIPPAGE_BPS = 100;
const DEFAULT_PRICE_AGE_SEC = 600;
const DEFAULT_PRICE_DEVIATION_BPS = 300;

const MoneyValueSchema = z.union([z.string(), z.number().finite().nonnegative()]).nullable().optional();

/** Loose, provider-facing extraction. The final draft is validated separately. */
export const MandateModelOutputSchema = z
  .object({
    maxTotalSpendUsd: MoneyValueSchema,
    maxPerActionUsd: MoneyValueSchema,
    minLiquidReserveUsd: MoneyValueSchema,
    maxSlippageBps: z.number().int().min(0).max(10_000).nullable().optional(),
    validForSec: z.number().int().positive().nullable().optional(),
    validUntil: z.string().nullable().optional(),
    lockedTokenSymbols: z.array(z.string()).nullable().optional(),
    allowedActions: z.array(z.enum(['REPAY', 'SUPPLY_COLLATERAL', 'SWAP', 'BORROW'])).nullable().optional(),
    allowBorrow: z.boolean().nullable().optional(),
    swapAllowed: z.boolean().nullable().optional(),
    unresolvedFields: z.array(z.string()).nullable().optional(),
  })
  .strict();

export type MandateModelOutput = z.infer<typeof MandateModelOutputSchema>;

export interface CompileAuditEvent {
  kind: 'mandate.compiled' | 'injection.suspected';
  data: Record<string, unknown>;
}

export interface CompileOptions {
  registry: TokenRegistry;
  /** Deterministic clock. Pass it explicitly in tests/eval; no hidden clock in the normalizer. */
  nowSec: number | bigint;
  audit?: (event: CompileAuditEvent) => void;
}

export class MandateCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MandateCompileError';
  }
}

export class DraftHasClarificationsError extends Error {
  constructor(readonly fields: string[]) {
    super(`mandate draft cannot be confirmed while clarifications exist: ${fields.join(', ')}`);
    this.name = 'DraftHasClarificationsError';
  }
}

export function parseUsdToUsd8(value: string | number | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  let raw = (typeof value === 'number' ? String(value) : value).trim();
  if (raw === '') return null;
  raw = raw
    .replace(/^\$\s*/, '')
    .replace(/,/g, '')
    .replace(/^usd\s*/i, '')
    .replace(/\s*(?:usd|dollars?)$/i, '')
    .trim();
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(raw);
  if (!match?.[1]) return null;
  const fraction = (match[2] ?? '').padEnd(8, '0');
  return BigInt(match[1]) * USDC_SCALE + BigInt(fraction);
}

function formatUsd8(value: bigint): string {
  const whole = value / USDC_SCALE;
  const fraction = (value % USDC_SCALE).toString().padStart(8, '0').slice(0, 2);
  return `$${whole.toString()}.${fraction}`;
}

interface MoneyMatch {
  value: bigint;
  context: string;
}

const MONEY_RE = /\$?\s*(\d[\d,]*(?:\.\d{1,8})?)(?:\s*(?:usd|dollars?))?/gi;

function clauseAt(text: string, index: number, length: number): string {
  let start = 0;
  let end = text.length;
  const delimiter = /,|;|\n|\.(?=\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = delimiter.exec(text)) !== null) {
    if (match.index < index) start = match.index + 1;
    else if (match.index >= index + length) {
      end = match.index;
      break;
    }
  }
  return text.slice(start, end).toLowerCase();
}

function moneyMatches(text: string): MoneyMatch[] {
  const matches: MoneyMatch[] = [];
  MONEY_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MONEY_RE.exec(text)) !== null) {
    const token = match[1];
    if (!token) continue;
    const value = parseUsdToUsd8(token);
    if (value === null) continue;
    matches.push({ value, context: clauseAt(text, match.index, match[0].length) });
  }
  return matches;
}

function uniqueSorted(values: bigint[]): bigint[] {
  return [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function excludedFromBudget(context: string): boolean {
  if (/\bper[- ]action\b|\beach action\b/.test(context)) return true;
  if (/%|\bslippage\b/.test(context)) return true;
  if (/\b(?:reserve|liquid)\b/.test(context) && /\b(?:keep|hold|maintain|always)\b/.test(context)) return true;
  return false;
}

/** Amounts explicitly tied to a total/budget/spend cap, never per-action or reserve amounts. */
export function extractTotalBudgetCandidates(text: string): bigint[] {
  return uniqueSorted(
    moneyMatches(text)
      .filter(
        (entry) =>
          !excludedFromBudget(entry.context) &&
          /\b(?:total|budget|spend|up to|at most|no more than|max(?:imum)?)\b/.test(entry.context),
      )
      .map((entry) => entry.value),
  );
}

function extractPerActionCandidates(text: string): bigint[] {
  return uniqueSorted(
    moneyMatches(text)
      .filter((entry) => /\bper[- ]action\b|\beach action\b/.test(entry.context))
      .map((entry) => entry.value),
  );
}

function extractReserveCandidates(text: string): bigint[] {
  return uniqueSorted(
    moneyMatches(text)
      .filter(
        (entry) =>
          /\b(?:reserve|liquid)\b/.test(entry.context) &&
          /\b(?:keep|hold|maintain|always)\b/.test(entry.context),
      )
      .map((entry) => entry.value),
  );
}

function extractSlippageBps(text: string): number | null {
  const pattern = /(\d+(?:\.\d{1,2})?)\s*%/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const context = text
      .slice(Math.max(0, match.index - 40), Math.min(text.length, match.index + match[0].length + 20))
      .toLowerCase();
    if (!/\bslippage\b/.test(context)) continue;
    return Math.round(Number(match[1]) * 100);
  }
  return null;
}

function extractDurationSec(text: string): number | null {
  const match = /\b(?:valid\s+(?:for|until)\s+)?(\d+(?:\.\d+)?)\s*(minutes?|hours?|days?)\b/i.exec(text);
  if (!match?.[1] || !match[2]) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2].toLowerCase();
  const multiplier = unit.startsWith('minute') ? 60 : unit.startsWith('hour') ? 3_600 : 86_400;
  return Math.round(value * multiplier);
}

function tomorrowNoonUtc(nowSec: number): number {
  const tomorrow = new Date((nowSec + 86_400) * 1_000);
  return Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 12, 0, 0) / 1_000;
}

const TOKEN_DETECTORS: ReadonlyArray<{ symbol: TokenSymbol; pattern: RegExp }> = [
  { symbol: 'mWSTETH', pattern: /\b(?:mwsteth|wsteth|staked\s+eth)\b/gi },
  { symbol: 'mWETH', pattern: /\b(?:mweth|weth|eth)\b/gi },
  { symbol: 'mUSDC', pattern: /\b(?:musdc|usdc)\b/gi },
];

function detectTokens(text: string): TokenSymbol[] {
  let remaining = text;
  const found: TokenSymbol[] = [];
  for (const detector of TOKEN_DETECTORS) {
    detector.pattern.lastIndex = 0;
    if (detector.pattern.test(remaining)) found.push(detector.symbol);
    remaining = remaining.replace(detector.pattern, ' ');
  }
  return found;
}

const PRESERVATION_CUE = /\b(?:keep|hold|untouched|don'?t\s+(?:sell|touch)|never\s+sell|long[- ]term|leave)\b/i;
const ASSET_WORD = /\b(?:coins?|assets?|tokens?|holdings?|portfolio)\b/i;

function detectsLockIntent(text: string): { tokens: TokenSymbol[]; ambiguous: boolean } {
  const clauses = text.split(/[.;\n]+|,\s*/);
  const tokens = new Set<TokenSymbol>();
  let ambiguous = false;

  for (const clause of clauses) {
    if (!PRESERVATION_CUE.test(clause)) continue;
    const reserveClause =
      /\b(?:reserve|liquid)\b/i.test(clause) &&
      /\b(?:keep|hold|maintain)\b/i.test(clause) &&
      !/\b(?:untouched|never\s+sell|don'?t\s+(?:sell|touch))\b/i.test(clause);
    if (reserveClause) continue;

    const clauseTokens = detectTokens(clause);
    for (const token of clauseTokens) tokens.add(token);
    if (clauseTokens.length === 0 && ASSET_WORD.test(clause)) ambiguous = true;
  }

  return { tokens: [...tokens], ambiguous };
}

function textAllowsBorrow(text: string): boolean {
  if (/\b(?:never|no|don'?t|do\s+not|without)\b[\s\S]{0,24}\bborrow/i.test(text)) return false;
  if (!/\bborrow/i.test(text)) return false;
  return /\b(?:can|may|allowed|okay|ok|fine|helps?|more)\b/i.test(text);
}

function textAllowsSwap(text: string): boolean {
  if (/\b(?:no|never|don'?t|do\s+not|without)\b[\s\S]{0,24}\bswap/i.test(text)) return false;
  return /\bswap(?:ping|s)?\b/i.test(text);
}

function onlyAction(text: string): ActionType | null {
  if (/\bonly\s+repay(?:ing)?\b|\bnothing\s+but\s+repay/i.test(text)) return 'REPAY';
  if (/\bonly\s+supply(?:ing)?\b|\bnothing\s+but\s+supply/i.test(text)) return 'SUPPLY_COLLATERAL';
  return null;
}

function actionBits(actions: readonly ActionType[]): number {
  return actions.reduce((bits, action) => {
    if (action === 'REPAY') return bits | 1;
    if (action === 'SUPPLY_COLLATERAL') return bits | 2;
    if (action === 'SWAP') return bits | 4;
    return bits;
  }, 0);
}

function bitNames(bits: number): string[] {
  const names: string[] = [];
  if (bits & 1) names.push('REPAY');
  if (bits & 2) names.push('SUPPLY_COLLATERAL');
  if (bits & 4) names.push('SWAP');
  return names;
}

function addClarification(
  clarifications: { field: string; question: string }[],
  field: string,
  question: string,
): void {
  if (!clarifications.some((entry) => entry.field === field)) clarifications.push({ field, question });
}

function addAssumption(
  assumptions: { field: string; value: string; reason: 'default' | 'inferred' }[],
  field: string,
  value: string,
  reason: 'default' | 'inferred',
): void {
  if (!assumptions.some((entry) => entry.field === field)) assumptions.push({ field, value, reason });
}

function symbolFor(registry: TokenRegistry, address: string): string {
  const found = (Object.entries(registry.tokens) as Array<[TokenSymbol, string]>).find(
    ([, candidate]) => candidate.toLowerCase() === address.toLowerCase(),
  );
  return found?.[0] ?? address;
}

interface NormalizedDraft {
  draft: MandateDraft;
  unresolved: string[];
}

function normalize(text: string, model: MandateModelOutput, options: CompileOptions): NormalizedDraft {
  const nowNumber = typeof options.nowSec === 'bigint' ? Number(options.nowSec) : options.nowSec;
  if (!Number.isSafeInteger(nowNumber) || nowNumber <= 0) {
    throw new MandateCompileError('nowSec must be a positive safe integer');
  }
  const now = BigInt(nowNumber);
  const clarifications: { field: string; question: string }[] = [];
  const assumptions: { field: string; value: string; reason: 'default' | 'inferred' }[] = [];

  const rawTotal = parseUsdToUsd8(model.maxTotalSpendUsd);
  const totalCandidates = extractTotalBudgetCandidates(text);
  let total = 0n;

  if (totalCandidates.length === 0) {
    addClarification(
      clarifications,
      'maxTotalSpendUsd',
      'What is the maximum total amount (USD) you want the agent to spend? A hard cap is required.',
    );
  } else {
    const smallest = totalCandidates[0] as bigint;
    if (rawTotal === null) {
      total = smallest;
      if (totalCandidates.length > 1) {
        addClarification(
          clarifications,
          'maxTotalSpendUsd',
          'The text gives more than one total budget. Which single total cap should apply?',
        );
      }
    } else if (rawTotal === smallest && totalCandidates.length === 1) {
      total = smallest;
    } else {
      total = rawTotal < smallest ? rawTotal : smallest;
      addClarification(
        clarifications,
        'maxTotalSpendUsd',
        'The model budget does not match the amount in your text. What single total cap should apply?',
      );
    }
  }
  if (total === 0n) {
    addClarification(
      clarifications,
      'maxTotalSpendUsd',
      'What is the maximum total amount (USD) you want the agent to spend? A hard cap is required.',
    );
  }

  const perCandidates = extractPerActionCandidates(text);
  const rawPer = parseUsdToUsd8(model.maxPerActionUsd);
  let per = total;
  let perIsDefault = true;
  if (perCandidates.length > 0) {
    per = perCandidates[0] as bigint;
    perIsDefault = false;
    if (rawPer !== null && rawPer !== per) {
      per = rawPer < per ? rawPer : per;
      addClarification(
        clarifications,
        'maxPerActionUsd',
        'The text and the draft disagree on the per-action limit. What single per-action cap should apply?',
      );
    }
  } else if (rawPer !== null && rawPer > 0n) {
    per = rawPer;
    perIsDefault = false;
  }
  if (per > total) {
    per = total;
    addClarification(
      clarifications,
      'maxPerActionUsd',
      'The per-action cap is larger than the total budget. What per-action cap should apply?',
    );
  }
  if (perIsDefault) {
    addAssumption(assumptions, 'maxPerActionUsd', formatUsd8(per), 'default');
  }

  const reserveCandidates = extractReserveCandidates(text);
  const rawReserve = parseUsdToUsd8(model.minLiquidReserveUsd);
  let reserve = 0n;
  let reserveIsDefault = true;
  if (reserveCandidates.length > 0) {
    reserve = reserveCandidates[0] as bigint;
    reserveIsDefault = false;
  } else if (rawReserve !== null && rawReserve > 0n) {
    reserve = rawReserve;
    reserveIsDefault = false;
    addAssumption(assumptions, 'minLiquidReserveUsd', formatUsd8(reserve), 'inferred');
  }
  if (reserveIsDefault) {
    addAssumption(assumptions, 'minLiquidReserveUsd', formatUsd8(reserve), 'default');
  }

  const textSlippageBps = extractSlippageBps(text);
  const modelSlippageBps = model.maxSlippageBps ?? null;
  let slippageBps = DEFAULT_SLIPPAGE_BPS;
  if (textSlippageBps !== null) {
    slippageBps = modelSlippageBps === null ? textSlippageBps : Math.min(textSlippageBps, modelSlippageBps);
  } else if (modelSlippageBps !== null) {
    slippageBps = modelSlippageBps;
    addAssumption(assumptions, 'maxSlippageBps', String(slippageBps), 'inferred');
  } else {
    addAssumption(assumptions, 'maxSlippageBps', String(slippageBps), 'default');
  }

  const explicitDuration = extractDurationSec(text);
  const tomorrowNoon = /\btomorrow\s+noon\b/i.test(text) ? tomorrowNoonUtc(nowNumber) : null;
  const modelDuration = model.validForSec ?? null;
  let duration = DEFAULT_VALIDITY_SEC;
  let validUntilIsDefault = true;

  if (tomorrowNoon !== null) {
    duration = tomorrowNoon - nowNumber;
    validUntilIsDefault = false;
  } else if (explicitDuration !== null) {
    duration = modelDuration === null ? explicitDuration : Math.min(explicitDuration, modelDuration);
    validUntilIsDefault = false;
  } else if (modelDuration !== null) {
    duration = modelDuration;
    validUntilIsDefault = false;
    addAssumption(
      assumptions,
      'validUntil',
      new Date((nowNumber + duration) * 1_000).toISOString(),
      'inferred',
    );
  } else if (model.validUntil) {
    const parsedUntil = Date.parse(model.validUntil);
    if (Number.isFinite(parsedUntil) && parsedUntil > nowNumber * 1_000) {
      duration = Math.floor(parsedUntil / 1_000) - nowNumber;
      validUntilIsDefault = false;
      addAssumption(assumptions, 'validUntil', new Date(parsedUntil).toISOString(), 'inferred');
    } else {
      addClarification(
        clarifications,
        'validUntil',
        'The expiry in the draft is invalid or in the past. What expiry should apply?',
      );
    }
  }
  if (validUntilIsDefault) {
    addAssumption(
      assumptions,
      'validUntil',
      new Date((nowNumber + duration) * 1_000).toISOString(),
      'default',
    );
  }
  const validUntil = now + BigInt(duration);

  const lockIntent = detectsLockIntent(text);
  if (lockIntent.ambiguous) {
    addClarification(
      clarifications,
      'lockedTokens',
      'Which asset do you want locked and left untouched (for example mWETH or mWSTETH)?',
    );
  }
  const lockedTokens = lockIntent.tokens.map((symbol) => options.registry.tokens[symbol]);

  const only = onlyAction(text);
  const allowsSwap = textAllowsSwap(text);
  const actions: ActionType[] = only ? [only] : ['REPAY', 'SUPPLY_COLLATERAL'];
  if (allowsSwap && only === null) actions.push('SWAP');
  const allowedActions = actionBits(actions);
  const allowBorrow = textAllowsBorrow(text);
  const allowedTargets = [options.registry.targets.lending];
  if ((allowedActions & 4) !== 0) allowedTargets.push(options.registry.targets.swap);

  if (only === null) {
    addAssumption(
      assumptions,
      'allowedActions',
      bitNames(allowedActions).join('|'),
      allowsSwap ? 'inferred' : 'default',
    );
  }
  addAssumption(assumptions, 'allowBorrow', String(allowBorrow), allowBorrow ? 'inferred' : 'default');
  addAssumption(
    assumptions,
    'allowedTargets',
    (allowedActions & 4) !== 0 ? 'lending,swap' : 'lending',
    (allowedActions & 4) !== 0 ? 'inferred' : 'default',
  );
  addAssumption(assumptions, 'maxPriceAgeSec', String(DEFAULT_PRICE_AGE_SEC), 'default');
  addAssumption(assumptions, 'maxPriceDeviationBps', String(DEFAULT_PRICE_DEVIATION_BPS), 'default');

  const actionLabels = bitNames(allowedActions).join(', ');
  const lockedLabels =
    lockedTokens.map((address) => symbolFor(options.registry, address)).join(', ') || 'none';
  const summaryPrefix = clarifications.length > 0 ? 'Incomplete draft. ' : '';
  const humanSummary =
    `${summaryPrefix}You allow at most ${formatUsd8(total)} in total and ${formatUsd8(per)} per action. ` +
    `Locked assets: ${lockedLabels}. Allowed actions: ${actionLabels || 'none'}. ` +
    `Borrowing: ${allowBorrow ? 'allowed' : 'disabled'}. Valid until ${new Date(Number(validUntil) * 1_000).toISOString()}. ` +
    `Minimum liquid reserve: ${formatUsd8(reserve)}. Max slippage: ${slippageBps} bps.`;

  const encoded = {
    mandate: {
      validFrom: now.toString(),
      validUntil: validUntil.toString(),
      maxTotalSpendUsd: total.toString(),
      maxPerActionUsd: per.toString(),
      minLiquidReserveUsd: reserve.toString(),
      maxSlippageBps: slippageBps,
      maxPriceAgeSec: DEFAULT_PRICE_AGE_SEC,
      maxPriceDeviationBps: DEFAULT_PRICE_DEVIATION_BPS,
      allowedActions,
      allowBorrow,
      allowedTargets,
      lockedTokens,
    },
    humanSummary,
    clarifications,
    assumptions,
  };

  const parsed = MandateDraftSchema.safeParse(encoded);
  if (!parsed.success) {
    throw new MandateCompileError(
      `normalized draft failed validation: ${parsed.error.issues
        .map((issue) => issue.path.join('.'))
        .join(', ')}`,
    );
  }
  return { draft: parsed.data, unresolved: clarifications.map((entry) => entry.field) };
}

/** Compile is not authorization: the owner confirms the returned draft elsewhere. */
export async function compileMandate(
  text: string,
  llm: LlmClient,
  options: CompileOptions,
): Promise<MandateDraft> {
  if (text.trim() === '') throw new MandateCompileError('mandate text is empty');
  const safeText = sanitizeUntrusted(text);
  const injection = detectInjection(text);
  if (injection.length > 0) {
    options.audit?.({
      kind: 'injection.suspected',
      data: { source: 'user:mandate', patterns: injection.map((finding) => finding.id) },
    });
  }

  const response = await llm.complete({
    system: COMPILE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: wrapUntrusted('user:mandate', text) }],
    schema: MandateModelOutputSchema,
    temperature: 0,
  });

  let candidate: unknown = response.structured;
  if (candidate === undefined) {
    const call = response.toolCalls.find((toolCall) => toolCall.name === 'compile_mandate');
    candidate = call?.arguments;
  }
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      throw new MandateCompileError('model returned structured output that is not valid JSON');
    }
  }
  if (candidate === undefined || candidate === null) {
    throw new MandateCompileError('model returned no structured mandate output');
  }

  const model = MandateModelOutputSchema.safeParse(candidate);
  if (!model.success) {
    throw new MandateCompileError(
      `model output failed schema: ${model.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  }

  const normalized = normalize(safeText, model.data, options);
  options.audit?.({
    kind: 'mandate.compiled',
    data: {
      model: response.model,
      temperature: response.temperature,
      usage: response.usage,
      maxTotalSpendUsd: normalized.draft.mandate.maxTotalSpendUsd.toString(),
      allowedActions: normalized.draft.mandate.allowedActions,
      allowBorrow: normalized.draft.mandate.allowBorrow,
      clarifications: normalized.unresolved,
      injectionPatterns: injection.map((finding) => finding.id),
    },
  });
  return normalized.draft;
}

export function isDraftConfirmable(draft: MandateDraft): boolean {
  return (
    draft.clarifications.length === 0 &&
    draft.mandate.maxTotalSpendUsd > 0n &&
    draft.mandate.maxPerActionUsd > 0n &&
    draft.mandate.validUntil > draft.mandate.validFrom
  );
}

/** Owner confirmation must fail closed while any clarification remains. */
export function assertDraftConfirmable(draft: MandateDraft): void {
  if (draft.clarifications.length > 0) {
    throw new DraftHasClarificationsError(draft.clarifications.map((entry) => entry.field));
  }
  if (!isDraftConfirmable(draft)) {
    throw new MandateCompileError('mandate draft has no positive budget or has an invalid validity window');
  }
}

