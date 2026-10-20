import { randomUUID } from 'node:crypto';

import {
  AuditLog,
  checkPostConditions,
  encodeJson,
  ledgerEntryFromResult,
  optimizeRescue,
  reconcileLedgerEntry,
  type Action,
  type Address,
  type AuditEntry,
  type ChainPort,
  type ErrorName,
  type HaltReason,
  type Hex,
  type LedgerEntry,
  type Mandate,
  type Plan,
  type PlanAction,
  type PositionSnapshot,
  type PriceSnapshot,
  type RunState,
  type SubmitResult,
  type VaultSnapshot,
} from '@marginpilot/core';

import { explainPlan } from './explain.js';
import type { LlmClient, LlmMessage, LlmToolCall } from './llm/client.js';
import { compileMandate } from './mandate/compile.js';
import type { TokenRegistry } from './mandate/registry.js';
import { TOOL_ARG_SCHEMAS, TOOL_DEFINITIONS, isToolName } from './tools.js';

export const DEFAULT_MAX_TOOL_CALLS = 30;
export const DEFAULT_MAX_REPLANS = 3;
export const DEFAULT_MAX_PLAN_AGE_BLOCKS = 2;

const ORCHESTRATOR_SYSTEM_PROMPT = `You are MarginPilot's rescue orchestrator.
You can only call the provided tools. The chain port is the only source of numbers; never invent a balance, price, HF, amount, nonce or hash.
Compile and planning are advisory. The vault is the enforcer and the owner remains the authority.
Use plan_rescue, then execute the plan's actions in order. Never bypass a failed simulation, never resubmit an UNKNOWN transaction, and halt when the state is stale or conflicting.
Use finish_run only after execution and verification, or halt_and_ask_owner when the owner must decide.
Never request, print or store a private key, seed phrase or API key.`;

const ORCHESTRATOR_USER_PROMPT =
  'Rescue the vault within the active mandate. Start with get_state, make a plan, then execute it. Use only the tools. Finish with finish_run, or halt_and_ask_owner if you cannot act safely.';

type TerminalState = 'COMPLETED' | 'COMPLETED_PARTIAL' | 'HALTED_NEEDS_OWNER' | 'ABORTED';

export interface OrchestratorMarket {
  reserveToken: Address;
  lendingSim: Address;
  tokenDecimals: Record<Address, number>;
}

export interface OrchestratorOptions {
  chain: ChainPort;
  llm: LlmClient;
  market: OrchestratorMarket;
  /** Optional provider used only by the compile_mandate tool. */
  compileLlm?: LlmClient;
  registry?: TokenRegistry;
  runId?: string;
  now?: () => number;
  audit?: AuditLog;
  maxToolCalls?: number;
  maxReplans?: number;
  maxPlanAgeBlocks?: number;
}

export interface RunReport {
  state: RunState;
  planId?: string;
  spentUsd8: bigint;
  remainingUsd8: bigint;
  unsavedPools: number[];
  healthFactors: { poolId: number; healthFactor: bigint }[];
  actionsMined: number;
  actionsRejected: number;
  actionsUnknown: number;
  remainingActions: number;
  txHashes: Hex[];
  haltReason?: HaltReason;
  summary: string;
}

export interface RunResult {
  runId: string;
  state: RunState;
  report: RunReport;
  ledger: LedgerEntry[];
  audit: AuditEntry[];
  plan?: Plan;
  replans: number;
  toolCalls: number;
  haltReason?: HaltReason;
  error?: string;
}

interface Snapshot {
  vault: VaultSnapshot;
  mandate: Mandate | null;
  positions: PositionSnapshot[];
  prices: PriceSnapshot[];
}

interface ExecuteResult {
  ok: boolean;
  txHash?: Hex;
  status?: SubmitResult['status'];
  spendUsd8?: bigint;
  error?: ErrorName | 'Unknown' | 'InvalidPlan';
  raw?: string;
  needsReplan?: boolean;
  planComplete?: boolean;
  reconciled?: boolean;
}

function formatUsd8(value: bigint): string {
  const whole = value / 100_000_000n;
  const fraction = (value % 100_000_000n).toString().padStart(8, '0').slice(0, 2);
  return `$${whole.toString()}.${fraction}`;
}

function addressKey(address: string): string {
  return address.toLowerCase();
}

function uniqueAddresses(addresses: readonly Address[]): Address[] {
  const seen = new Map<string, Address>();
  for (const address of addresses) {
    if (!seen.has(addressKey(address))) seen.set(addressKey(address), address);
  }
  return [...seen.values()];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function jsonContent(value: unknown): string {
  return JSON.stringify(encodeJson(withoutUndefined(value)));
}

function withoutUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, withoutUndefined(entry)]),
    );
  }
  return value;
}

export class RescueOrchestrator {
  private readonly chain: ChainPort;
  private readonly llm: LlmClient;
  private readonly market: OrchestratorMarket;
  private readonly compileLlm?: LlmClient;
  private readonly registry?: TokenRegistry;
  private readonly now: () => number;
  private readonly auditLog: AuditLog;
  private readonly maxToolCalls: number;
  private readonly maxReplans: number;
  private readonly maxPlanAgeBlocks: number;
  readonly runId: string;

  private readonly ledger: LedgerEntry[] = [];
  private state: RunState = 'IDLE';
  private currentPlanValue: Plan | null = null;
  private nextActionIndex = 0;
  private replans = 0;
  private toolCalls = 0;
  private planPrices = new Map<string, bigint>();
  private planPriceTokens: Address[] = [];
  private lastSnapshot?: Snapshot;
  private activeMandate: Mandate | null = null;
  private haltReason?: HaltReason;
  private lastError?: string;
  private finished = false;
  private halted = false;
  private aborted = false;
  private reportAudited = false;
  private explanation?: { planId: string; text: string };

  constructor(options: OrchestratorOptions) {
    this.chain = options.chain;
    this.llm = options.llm;
    this.market = options.market;
    this.compileLlm = options.compileLlm;
    this.registry = options.registry;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1_000));
    this.runId = options.runId ?? `run-${randomUUID()}`;
    this.maxToolCalls = options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
    this.maxReplans = options.maxReplans ?? DEFAULT_MAX_REPLANS;
    this.maxPlanAgeBlocks = options.maxPlanAgeBlocks ?? DEFAULT_MAX_PLAN_AGE_BLOCKS;
    this.auditLog = options.audit ?? new AuditLog(this.runId);
  }

  get currentPlan(): Plan | null {
    return this.currentPlanValue;
  }

  get audit(): AuditEntry[] {
    return [...this.auditLog.entries];
  }

  /** Kill switch used by the API/operator. Pauses the vault and stops this run. */
  async kill(reason = 'operator kill switch'): Promise<void> {
    if (this.finished || this.halted || this.aborted) return;
    this.aborted = true;
    this.state = 'ABORTED';
    this.auditLog.append('abort', { reason, source: 'kill_switch' });
    try {
      await this.chain.pause();
    } catch (error) {
      this.auditLog.append('abort', { reason, source: 'kill_switch', pauseError: errorMessage(error) });
    }
  }

  async run(): Promise<RunResult> {
    if (this.aborted) {
      this.state = 'ABORTED';
      return this.finalize();
    }

    this.state = 'OBSERVING';
    try {
      await this.observe(true);
    } catch (error) {
      this.abort(`initial observation failed: ${errorMessage(error)}`);
      return this.finalize();
    }
    this.state = 'PLANNING';

    const messages: LlmMessage[] = [{ role: 'user', content: ORCHESTRATOR_USER_PROMPT }];
    while (!this.isTerminal()) {
      if (this.toolCalls >= this.maxToolCalls) {
        this.abort(`MAX_TOOL_CALLS reached (${this.maxToolCalls})`);
        break;
      }

      let response;
      try {
        response = await this.llm.complete({
          system: ORCHESTRATOR_SYSTEM_PROMPT,
          messages,
          tools: TOOL_DEFINITIONS,
          temperature: 0,
        });
      } catch (error) {
        this.abort(`LLM call failed: ${errorMessage(error)}`);
        break;
      }

      if (response.toolCalls.length === 0) {
        this.abort('model returned no tool call');
        break;
      }

      for (const call of response.toolCalls) {
        if (this.isTerminal()) break;
        this.toolCalls += 1;
        if (this.toolCalls > this.maxToolCalls) {
          this.abort(`MAX_TOOL_CALLS exceeded (${this.maxToolCalls})`);
          break;
        }
        const result = await this.dispatch(call);
        messages.push({ role: 'tool', name: call.name, content: jsonContent(result) });
      }
    }

    if (!this.finished && !this.halted && !this.aborted) {
      this.abort('run loop ended without finish_run or halt');
    }
    return this.finalize();
  }

  /** Template-only plan explanation for the API/tests. */
  explainCurrentPlan(): string | null {
    if (!this.currentPlanValue || !this.activeMandate || !this.lastSnapshot) return null;
    if (this.explanation?.planId === this.currentPlanValue.planId) return this.explanation.text;
    const text = explainPlan(this.currentPlanValue, this.activeMandate, this.lastSnapshot.vault);
    this.explanation = { planId: this.currentPlanValue.planId, text };
    return text;
  }

  private isTerminal(): boolean {
    return this.finished || this.halted || this.aborted;
  }

  private async observe(withAudit: boolean): Promise<Snapshot> {
    const vault = await this.chain.getVault();
    const mandate = await this.chain.getMandate();
    const positions = await this.chain.getPositions();
    const tokens = uniqueAddresses([
      ...positions.flatMap((position) => [position.collateralToken, position.debtToken]),
      this.market.reserveToken,
    ]);
    const prices = await this.chain.getPrices(tokens);
    const snapshot: Snapshot = { vault, mandate, positions, prices };
    this.lastSnapshot = snapshot;
    this.activeMandate = mandate;
    if (withAudit) {
      this.auditLog.append('observe', {
        blockNumber: vault.blockNumber,
        blockTimestamp: vault.blockTimestamp,
        paused: vault.paused,
        activeMandateId: vault.activeMandateId,
        positionCount: positions.length,
        priceCount: prices.length,
      });
    }
    return snapshot;
  }

  private async dispatch(call: LlmToolCall): Promise<unknown> {
    if (!isToolName(call.name)) {
      this.auditLog.append('tool.invalid', { tool: call.name, reason: 'not in the fixed tool set' });
      return { ok: false, error: 'UnknownTool' };
    }

    let rawArguments: unknown = call.arguments;
    if (typeof rawArguments === 'string') {
      try {
        rawArguments = JSON.parse(rawArguments) as unknown;
      } catch {
        return { ok: false, error: 'InvalidToolArguments' };
      }
    }
    const args = TOOL_ARG_SCHEMAS[call.name].safeParse(rawArguments);
    if (!args.success) {
      this.auditLog.append('tool.invalid', {
        tool: call.name,
        reason: 'invalid arguments',
        fields: args.error.issues.map((issue) => issue.path.join('.')),
      });
      return { ok: false, error: 'InvalidToolArguments' };
    }

    try {
      switch (call.name) {
        case 'get_state': {
          const snapshot = await this.observe(true);
          return { ok: true, state: this.stateView(snapshot) };
        }
        case 'get_run_history':
          return {
            ok: true,
            ledger: this.ledger,
            audit: this.auditLog.entries.map((entry) => ({
              seq: entry.seq,
              kind: entry.kind,
              data: entry.data,
            })),
          };
        case 'compile_mandate':
          return await this.compileTool(args.data.text);
        case 'plan_rescue':
          return await this.planRescue();
        case 'explain_plan':
          return this.explainTool(args.data.planId);
        case 'execute_plan_action':
          return await this.executePlanAction(args.data.planId, args.data.index);
        case 'pause_vault': {
          let txHash: Hex | undefined;
          try {
            txHash = await this.chain.pause();
          } catch (error) {
            this.auditLog.append('abort', {
              reason: args.data.reason,
              source: 'pause_vault',
              pauseError: errorMessage(error),
            });
            return { ok: false, error: 'PauseFailed' };
          }
          this.abort(`pause_vault: ${args.data.reason}`);
          return { ok: true, txHash };
        }
        case 'halt_and_ask_owner':
          this.halt(args.data.reason);
          return { ok: true, halted: true, reason: args.data.reason };
        case 'finish_run':
          return this.finishRun();
      }
    } catch (error) {
      this.auditLog.append('tool.error', { tool: call.name, error: errorMessage(error) });
      return { ok: false, error: 'ToolError', detail: errorMessage(error) };
    }
  }

  private stateView(snapshot: Snapshot): unknown {
    const mandate = snapshot.mandate;
    const remaining =
      mandate && mandate.maxTotalSpendUsd > snapshot.vault.spentUsd8
        ? mandate.maxTotalSpendUsd - snapshot.vault.spentUsd8
        : 0n;
    return {
      blockNumber: snapshot.vault.blockNumber,
      blockTimestamp: snapshot.vault.blockTimestamp,
      paused: snapshot.vault.paused,
      activeMandateId: snapshot.vault.activeMandateId,
      actionNonce: snapshot.vault.actionNonce,
      spentUsd8: snapshot.vault.spentUsd8,
      remainingUsd8: remaining,
      liquidReserveUsd8: snapshot.vault.liquidReserveUsd8,
      mandate,
      positions: snapshot.positions,
      prices: snapshot.prices,
      planId: this.currentPlanValue?.planId ?? null,
    };
  }

  private async compileTool(text: string): Promise<unknown> {
    if (!this.compileLlm || !this.registry) {
      return { ok: false, error: 'compile_mandate is not configured' };
    }
    const nowSec = this.lastSnapshot?.vault.blockTimestamp ?? BigInt(this.now());
    const draft = await compileMandate(text, this.compileLlm, {
      registry: this.registry,
      nowSec,
      audit: (event) => this.auditLog.append(event.kind, event.data),
    });
    return { ok: true, draft };
  }

  private explainTool(planId: string): unknown {
    if (!this.currentPlanValue || this.currentPlanValue.planId !== planId) {
      return { ok: false, error: 'InvalidPlan' };
    }
    const text = this.explainCurrentPlan();
    if (text === null) return { ok: false, error: 'NotReady' };
    this.auditLog.append('plan.explained', { planId, text });
    return { ok: true, text };
  }

  private async planRescue(): Promise<unknown> {
    const snapshot = await this.observe(false);
    if (!snapshot.mandate) {
      this.halt({ kind: 'MANDATE_INVALID', error: 'MandateInactive' });
      return { ok: false, error: 'MandateInactive' };
    }
    if (snapshot.vault.paused) {
      this.halt({ kind: 'PAUSED' });
      return { ok: false, error: 'Paused' };
    }
    if (this.currentPlanValue) {
      if (this.replans >= this.maxReplans) {
        this.halt({
          kind: 'NEEDS_OWNER_DECISION',
          detail: `MAX_REPLANS reached (${this.maxReplans})`,
        });
        return { ok: false, error: 'ReplanLimitExceeded' };
      }
      this.replans += 1;
    }

    const previous = this.currentPlanValue;
    const plan = optimizeRescue({
      positions: snapshot.positions,
      prices: snapshot.prices,
      mandate: snapshot.mandate,
      vault: snapshot.vault,
      market: {
        ...this.market,
        now: snapshot.vault.blockTimestamp,
        version: (previous?.version ?? 0) + 1,
      },
    });

    this.currentPlanValue = plan;
    this.nextActionIndex = 0;
    this.explanation = undefined;
    this.planPriceTokens = this.collectPlanPriceTokens(plan, snapshot.positions);
    this.planPrices = new Map(snapshot.prices.map((price) => [addressKey(price.token), price.priceUsd8]));
    // A SWAP output token may not be part of a position; fail closed if the optimizer
    // produced an action with a token the state read did not price.
    const missing = this.planPriceTokens.filter((token) => !this.planPrices.has(addressKey(token)));
    if (missing.length > 0) {
      try {
        const extra = await this.chain.getPrices(missing);
        for (const price of extra) this.planPrices.set(addressKey(price.token), price.priceUsd8);
      } catch (error) {
        this.halt({
          kind: 'STALE_OR_CONFLICTING_DATA',
          detail: `missing plan price: ${errorMessage(error)}`,
        });
        return { ok: false, error: 'StalePrice' };
      }
    }

    this.auditLog.append('plan', {
      planId: plan.planId,
      version: plan.version,
      basedOnBlock: plan.basedOnBlock,
      actions: plan.actions,
      totalSpendUsd8: plan.totalSpendUsd8,
      expectedLossUsd8: plan.expectedLossUsd8,
      unsavedPools: plan.unsavedPools,
      ...(plan.haltReason ? { haltReason: plan.haltReason } : {}),
    });
    if (previous) {
      this.auditLog.append('replan', {
        from: previous.planId,
        to: plan.planId,
        replans: this.replans,
        basedOnBlock: plan.basedOnBlock,
      });
    }

    if (plan.haltReason) {
      this.haltReason = plan.haltReason;
      this.halted = true;
      this.state = 'HALTED_NEEDS_OWNER';
      this.auditLog.append('halt', plan.haltReason);
    } else {
      this.state = 'EXECUTING';
    }

    return {
      ok: plan.haltReason === undefined,
      planId: plan.planId,
      version: plan.version,
      basedOnBlock: plan.basedOnBlock,
      actions: plan.actions.map((entry) => ({
        index: entry.index,
        actionType: entry.action.actionType,
        poolId: entry.rationale.poolId,
        spendUsd8: entry.rationale.spendUsd8,
      })),
      totalSpendUsd8: plan.totalSpendUsd8,
      unsavedPools: plan.unsavedPools,
      haltReason: plan.haltReason,
    };
  }

  private collectPlanPriceTokens(plan: Plan, positions: PositionSnapshot[]): Address[] {
    const tokens: Address[] = [this.market.reserveToken];
    for (const entry of plan.actions) {
      tokens.push(entry.action.tokenIn);
      if (entry.action.tokenOut) tokens.push(entry.action.tokenOut);
      const position = positions.find((candidate) => candidate.poolId === entry.action.poolId);
      if (position) tokens.push(position.collateralToken, position.debtToken);
    }
    return uniqueAddresses(tokens);
  }

  private async executePlanAction(planId: string, index: number): Promise<ExecuteResult> {
    const plan = this.currentPlanValue;
    if (!plan) {
      this.auditLog.append('action.rejected', { planId, index, error: 'InvalidPlan', reason: 'no plan' });
      return { ok: false, error: 'InvalidPlan' };
    }
    if (plan.planId !== planId) {
      this.auditLog.append('action.rejected', {
        planId,
        index,
        error: 'StaleAction',
        reason: 'plan id does not match the current plan',
      });
      return { ok: false, error: 'StaleAction', needsReplan: true };
    }
    if (!Number.isInteger(index) || index !== this.nextActionIndex) {
      this.auditLog.append('action.rejected', {
        planId,
        index,
        error: 'StaleAction',
        reason: 'plans must be executed in order',
      });
      return { ok: false, error: 'StaleAction', needsReplan: true };
    }
    const entry = plan.actions[index];
    if (!entry) {
      this.auditLog.append('action.rejected', { planId, index, error: 'InvalidPlan', reason: 'index out of range' });
      return { ok: false, error: 'InvalidPlan' };
    }

    const snapshot = await this.observe(false);
    if (!snapshot.mandate) {
      this.halt({ kind: 'MANDATE_INVALID', error: 'MandateInactive' });
      return { ok: false, error: 'MandateInactive' };
    }
    if (snapshot.vault.paused) {
      this.halt({ kind: 'PAUSED' });
      return { ok: false, error: 'Paused' };
    }

    const planAge = snapshot.vault.blockNumber - plan.basedOnBlock;
    if (planAge > BigInt(this.maxPlanAgeBlocks)) {
      this.state = 'REPLANNING';
      this.auditLog.append('replan', {
        reason: 'plan-age',
        planId,
        blockNumber: snapshot.vault.blockNumber,
        basedOnBlock: plan.basedOnBlock,
        planAgeBlocks: planAge,
      });
      this.auditLog.append('action.rejected', {
        planId,
        index,
        error: 'StaleAction',
        reason: `plan age ${planAge.toString()} exceeds ${this.maxPlanAgeBlocks}`,
      });
      return { ok: false, error: 'StaleAction', needsReplan: true };
    }

    if (snapshot.vault.actionNonce !== entry.action.nonce) {
      this.state = 'REPLANNING';
      this.auditLog.append('replan', {
        reason: 'nonce-mismatch',
        planId,
        expectedNonce: entry.action.nonce,
        actualNonce: snapshot.vault.actionNonce,
      });
      this.auditLog.append('action.rejected', {
        planId,
        index,
        error: 'StaleAction',
        reason: 'action nonce does not match vault nonce',
      });
      return { ok: false, error: 'StaleAction', needsReplan: true };
    }

    const deviationBps = await this.priceDrift();
    if (deviationBps > snapshot.mandate.maxPriceDeviationBps) {
      this.state = 'REPLANNING';
      this.auditLog.append('replan', {
        reason: 'price-drift',
        planId,
        actionIndex: index,
        deviationBps,
        maxPriceDeviationBps: snapshot.mandate.maxPriceDeviationBps,
      });
      this.auditLog.append('action.rejected', {
        planId,
        index,
        error: 'PriceDeviation',
        reason: `price drift ${deviationBps} bps exceeds ${snapshot.mandate.maxPriceDeviationBps}`,
      });
      return { ok: false, error: 'PriceDeviation', needsReplan: true };
    }

    let simulation: Awaited<ReturnType<ChainPort['simulate']>>;
    try {
      simulation = await this.chain.simulate(entry.action);
    } catch (error) {
      this.halt({ kind: 'NEEDS_OWNER_DECISION', detail: `simulation failed: ${errorMessage(error)}` });
      return { ok: false, error: 'Unknown', raw: errorMessage(error) };
    }
    if (!simulation.ok) {
      this.recordRejected(entry, simulation.error, simulation.raw, 'simulation rejected', planAge);
      if (simulation.error === 'StalePrice' || simulation.error === 'PriceDeviation') {
        this.halt({
          kind: 'STALE_OR_CONFLICTING_DATA',
          detail: `simulation rejected: ${simulation.error}`,
        });
        return { ok: false, error: simulation.error, raw: simulation.raw };
      }
      if (simulation.error === 'Paused') {
        this.halt({ kind: 'PAUSED' });
        return { ok: false, error: 'Paused', raw: simulation.raw };
      }
      if (simulation.error === 'StaleAction') {
        this.state = 'REPLANNING';
        return { ok: false, error: 'StaleAction', raw: simulation.raw, needsReplan: true };
      }
      if (simulation.error === 'BudgetExceeded' || simulation.error === 'PerActionCapExceeded') {
        this.state = 'REPLANNING';
        return { ok: false, error: simulation.error, needsReplan: true };
      }
      this.halt({
        kind: 'NEEDS_OWNER_DECISION',
        detail:
          simulation.error === 'Unknown'
            ? `simulation failed: Unknown (${simulation.raw ?? 'no raw reason'})`
            : `simulation rejected: ${simulation.error}`,
      });
      return { ok: false, error: simulation.error, raw: simulation.raw };
    }

    this.auditLog.append('action.validated', {
      planId,
      actionIndex: index,
      valueUsd8: simulation.valueUsd8,
      blockNumber: snapshot.vault.blockNumber,
    });

    let result: SubmitResult;
    try {
      result = await this.chain.submit(entry.action);
    } catch (error) {
      this.halt({ kind: 'NEEDS_OWNER_DECISION', detail: `submit failed: ${errorMessage(error)}` });
      return { ok: false, error: 'Unknown', raw: errorMessage(error) };
    }

    this.auditLog.append('action.submitted', {
      planId,
      actionIndex: index,
      txHash: result.txHash,
      status: result.status,
    });

    if (result.status === 'mined') {
      return this.onMined(entry, result, snapshot, false);
    }
    if (result.status === 'reverted') {
      this.recordReverted(entry, result);
      if (result.error === 'Paused') this.halt({ kind: 'PAUSED' });
      else if (result.error === 'StalePrice' || result.error === 'PriceDeviation') {
        this.halt({ kind: 'STALE_OR_CONFLICTING_DATA', detail: `transaction reverted: ${result.error}` });
      } else {
        this.halt({
          kind: 'NEEDS_OWNER_DECISION',
          detail: `transaction reverted: ${result.error}`,
        });
      }
      return { ok: false, error: result.error, txHash: result.txHash };
    }
    return this.onUnknown(entry, result, snapshot);
  }

  private recordRejected(
    entry: PlanAction,
    error: ErrorName | 'Unknown',
    raw: string | undefined,
    reason: string,
    planAgeBlocks: bigint,
  ): void {
    this.ledger.push({
      runId: this.runId,
      actionIndex: entry.index,
      mandateId: entry.action.mandateId,
      spendUsd8: 0n,
      gasWei: 0n,
      gasUsd8: null,
      status: 'reverted',
      ...(error === 'Unknown' ? {} : { error }),
      ts: this.now(),
    });
    this.auditLog.append('action.rejected', {
      planId: this.currentPlanValue?.planId,
      actionIndex: entry.index,
      error,
      ...(raw === undefined ? {} : { raw }),
      reason,
      planAgeBlocks,
    });
  }

  private recordReverted(entry: PlanAction, result: Extract<SubmitResult, { status: 'reverted' }>): void {
    this.ledger.push(
      ledgerEntryFromResult({
        runId: this.runId,
        actionIndex: entry.index,
        mandateId: entry.action.mandateId,
        result,
        gasUsd8: null,
        ts: this.now(),
      }),
    );
    this.auditLog.append('action.rejected', {
      planId: this.currentPlanValue?.planId,
      actionIndex: entry.index,
      txHash: result.txHash,
      error: result.error,
      reason: 'transaction reverted',
    });
  }

  private async onMined(
    entry: PlanAction,
    result: Extract<SubmitResult, { status: 'mined' }>,
    before: Snapshot,
    reconciled: boolean,
  ): Promise<ExecuteResult> {
    const after = await this.observe(false);
    const spendUsd8 =
      after.vault.spentUsd8 >= before.vault.spentUsd8
        ? after.vault.spentUsd8 - before.vault.spentUsd8
        : 0n;
    this.ledger.push(
      ledgerEntryFromResult({
        runId: this.runId,
        actionIndex: entry.index,
        mandateId: entry.action.mandateId,
        result,
        spendUsd8,
        gasUsd8: null,
        ts: this.now(),
      }),
    );
    this.nextActionIndex += 1;
    this.auditLog.append('action.mined', {
      planId: this.currentPlanValue?.planId,
      actionIndex: entry.index,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      spendUsd8,
      reconciled,
    });

    const post = this.postCondition(entry, before, after);
    if (!post.ok) {
      this.auditLog.append('action.mismatch', {
        planId: this.currentPlanValue?.planId,
        actionIndex: entry.index,
        error: post.error,
      });
      this.halt({
        kind: 'NEEDS_OWNER_DECISION',
        detail: `post-condition failed after tx ${result.txHash}: ${post.error}`,
      });
      return { ok: true, txHash: result.txHash, status: 'mined', spendUsd8, reconciled };
    }

    const deviationBps = await this.priceDrift();
    const planComplete =
      this.currentPlanValue !== null && this.nextActionIndex >= this.currentPlanValue.actions.length;
    if (deviationBps > (before.mandate?.maxPriceDeviationBps ?? 0)) {
      this.state = 'REPLANNING';
      this.auditLog.append('replan', {
        reason: 'price-drift-after-action',
        planId: this.currentPlanValue?.planId,
        actionIndex: entry.index,
        deviationBps,
        maxPriceDeviationBps: before.mandate?.maxPriceDeviationBps ?? 0,
      });
      return {
        ok: true,
        txHash: result.txHash,
        status: 'mined',
        spendUsd8,
        needsReplan: true,
        planComplete,
        reconciled,
      };
    }

    this.state = planComplete ? 'VERIFYING' : 'EXECUTING';
    return {
      ok: true,
      txHash: result.txHash,
      status: 'mined',
      spendUsd8,
      planComplete,
      reconciled,
    };
  }

  private async onUnknown(
    entry: PlanAction,
    result: Extract<SubmitResult, { status: 'unknown' }>,
    before: Snapshot,
  ): Promise<ExecuteResult> {
    let tx: Awaited<ReturnType<ChainPort['getTx']>>;
    try {
      tx = await this.chain.getTx(result.txHash);
    } catch (error) {
      this.ledger.push(
        ledgerEntryFromResult({
          runId: this.runId,
          actionIndex: entry.index,
          mandateId: entry.action.mandateId,
          result,
          gasUsd8: null,
          ts: this.now(),
        }),
      );
      this.auditLog.append('action.unknown', {
        planId: this.currentPlanValue?.planId,
        actionIndex: entry.index,
        txHash: result.txHash,
        reason: `getTx failed: ${errorMessage(error)}`,
      });
      this.halt({
        kind: 'STALE_OR_CONFLICTING_DATA',
        detail: `transaction ${result.txHash} is unknown and could not be reconciled; it was not resubmitted`,
      });
      return { ok: false, error: 'Unknown', raw: errorMessage(error), txHash: result.txHash };
    }

    if (tx.status === 'mined' && tx.success) {
      const mined: Extract<SubmitResult, { status: 'mined' }> = {
        status: 'mined',
        txHash: result.txHash,
        blockNumber: tx.blockNumber,
        gasUsed: tx.gasUsed,
        effectiveGasPrice: tx.effectiveGasPrice,
      };
      return this.onMined(entry, mined, before, true);
    }

    if (tx.status === 'mined') {
      const pending = ledgerEntryFromResult({
        runId: this.runId,
        actionIndex: entry.index,
        mandateId: entry.action.mandateId,
        result,
        gasUsd8: null,
        ts: this.now(),
      });
      this.ledger.push(reconcileLedgerEntry(pending, tx));
      this.auditLog.append('action.rejected', {
        planId: this.currentPlanValue?.planId,
        actionIndex: entry.index,
        txHash: result.txHash,
        error: tx.error ?? 'Unknown',
        reason: 'unknown transaction reconciled as reverted',
      });
      this.halt({
        kind: 'STALE_OR_CONFLICTING_DATA',
        detail: `transaction ${result.txHash} mined but failed; it was not resubmitted`,
      });
      return { ok: false, error: tx.error ?? 'Unknown', txHash: result.txHash };
    }

    this.ledger.push(
      ledgerEntryFromResult({
        runId: this.runId,
        actionIndex: entry.index,
        mandateId: entry.action.mandateId,
        result,
        gasUsd8: null,
        ts: this.now(),
      }),
    );
    this.auditLog.append('action.unknown', {
      planId: this.currentPlanValue?.planId,
      actionIndex: entry.index,
      txHash: result.txHash,
      status: tx.status,
      reason: 'not found or still pending; not resubmitted',
    });
    this.halt({
      kind: 'STALE_OR_CONFLICTING_DATA',
      detail: `transaction ${result.txHash} is ${tx.status}; it was not resubmitted`,
    });
    return { ok: false, error: 'Unknown', txHash: result.txHash, needsReplan: false };
  }

  private postCondition(
    entry: PlanAction,
    before: Snapshot,
    after: Snapshot,
  ): { ok: true } | { ok: false; error: ErrorName } {
    if (!before.mandate) return { ok: false, error: 'MandateInactive' };
    const positionBefore = before.positions.find((position) => position.poolId === entry.action.poolId);
    const positionAfter = after.positions.find((position) => position.poolId === entry.action.poolId);
    return checkPostConditions(
      { action: entry.action, mandate: before.mandate },
      {
        liquidReserveUsd8: before.vault.liquidReserveUsd8,
        healthFactor: positionBefore?.healthFactor ?? 0n,
      },
      {
        liquidReserveUsd8: after.vault.liquidReserveUsd8,
        healthFactor: positionAfter?.healthFactor ?? 0n,
      },
    );
  }

  private async priceDrift(): Promise<number> {
    if (!this.currentPlanValue || this.planPriceTokens.length === 0) return 0;
    let current: PriceSnapshot[];
    try {
      current = await this.chain.getPrices(this.planPriceTokens);
    } catch {
      return 10_000;
    }
    let maximum = 0;
    for (const price of current) {
      const planned = this.planPrices.get(addressKey(price.token));
      if (planned === undefined || planned === 0n) return 10_000;
      const difference = price.priceUsd8 > planned ? price.priceUsd8 - planned : planned - price.priceUsd8;
      const bps = Number((difference * 10_000n) / planned);
      if (bps > maximum) maximum = bps;
    }
    return maximum;
  }

  private finishRun(): unknown {
    if (!this.currentPlanValue) return { ok: false, error: 'NoPlan' };
    if (this.halted || this.aborted) return { ok: false, error: 'NotRunning' };
    const provisional = this.buildReport();
    const partial =
      provisional.unsavedPools.length > 0 ||
      provisional.remainingActions > 0 ||
      this.currentPlanValue.haltReason !== undefined;
    this.state = partial ? 'COMPLETED_PARTIAL' : 'COMPLETED';
    this.finished = true;
    return { ok: true, state: this.state, report: this.buildReport() };
  }

  private halt(reason: HaltReason): void {
    if (this.aborted || this.halted) return;
    this.haltReason = reason;
    this.halted = true;
    this.state = 'HALTED_NEEDS_OWNER';
    this.auditLog.append('halt', reason);
  }

  private abort(reason: string): void {
    if (this.aborted) return;
    this.aborted = true;
    this.state = 'ABORTED';
    this.lastError = reason;
    this.auditLog.append('abort', { reason });
  }

  private buildReport(): RunReport {
    const snapshot = this.lastSnapshot;
    const mandate = this.activeMandate ?? snapshot?.mandate ?? null;
    const plan = this.currentPlanValue;
    const spentUsd8 = snapshot?.vault.spentUsd8 ?? 0n;
    const remainingUsd8 =
      mandate && mandate.maxTotalSpendUsd > spentUsd8 ? mandate.maxTotalSpendUsd - spentUsd8 : 0n;
    const remainingActions = plan ? Math.max(0, plan.actions.length - this.nextActionIndex) : 0;

    const unsaved = new Set<number>(plan?.unsavedPools ?? []);
    if (plan) {
      for (let index = this.nextActionIndex; index < plan.actions.length; index += 1) {
        const entry = plan.actions[index];
        if (entry) unsaved.add(entry.rationale.poolId);
      }
    }
    const unsavedPools = [...unsaved].sort((left, right) => left - right);

    const mined = this.ledger.filter((entry) => entry.status === 'mined');
    const rejected = this.ledger.filter((entry) => entry.status === 'reverted');
    const unknown = this.ledger.filter((entry) => entry.status === 'unknown');
    const txHashes = this.ledger
      .map((entry) => entry.txHash)
      .filter((hash): hash is Hex => hash !== undefined);

    const haltText = this.haltReason ? ` Halt: ${this.haltReason.kind}.` : '';
    const summary =
      `${this.state}: spent ${formatUsd8(spentUsd8)}${mandate ? ` of ${formatUsd8(mandate.maxTotalSpendUsd)}` : ''}; ` +
      `${mined.length} mined, ${rejected.length} rejected, ${unknown.length} unknown.` +
      (unsavedPools.length > 0 ? ` Unsaved pools: ${unsavedPools.join(', ')}.` : '') +
      (remainingActions > 0 ? ` Remaining actions: ${remainingActions}.` : '') +
      haltText;

    return {
      state: this.state,
      ...(plan ? { planId: plan.planId } : {}),
      spentUsd8,
      remainingUsd8,
      unsavedPools,
      healthFactors: (snapshot?.positions ?? []).map((position) => ({
        poolId: position.poolId,
        healthFactor: position.healthFactor,
      })),
      actionsMined: mined.length,
      actionsRejected: rejected.length,
      actionsUnknown: unknown.length,
      remainingActions,
      txHashes,
      ...(this.haltReason ? { haltReason: this.haltReason } : {}),
      summary,
    };
  }

  private finalize(): RunResult {
    const report = this.buildReport();
    if (!this.reportAudited) {
      this.auditLog.append('report', report);
      this.reportAudited = true;
    }
    return {
      runId: this.runId,
      state: this.state,
      report,
      ledger: [...this.ledger],
      audit: [...this.auditLog.entries],
      ...(this.currentPlanValue ? { plan: this.currentPlanValue } : {}),
      replans: this.replans,
      toolCalls: this.toolCalls,
      ...(this.haltReason ? { haltReason: this.haltReason } : {}),
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }
}
