import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  MockChainPort,
  encodeJson,
  localThresholdBaseline,
  optimizeRescue,
  type Action,
  type Address,
  type ChainPort,
  type Hex,
  type Mandate,
  type MockChainConfig,
  type OptimizerInput,
  type PositionSnapshot,
  type PriceSnapshot,
  type SubmitResult,
  type TxStatus,
  type VaultSnapshot,
} from '@marginpilot/core';

import { ScriptedLlm, type ScriptedTrace } from '../../apps/agent/src/llm/scripted.js';
import { RescueOrchestrator } from '../../apps/agent/src/orchestrator.js';

const mUSDC: Address = '0x00000000000000000000000000000000000000a1';
const mWETH: Address = '0x00000000000000000000000000000000000000a2';
const mWSTETH: Address = '0x00000000000000000000000000000000000000a3';
const LENDING: Address = '0x00000000000000000000000000000000000000b1';
const SWAP: Address = '0x00000000000000000000000000000000000000b3';
const OWNER: Address = '0x00000000000000000000000000000000000000e3';
const EXECUTOR: Address = '0x00000000000000000000000000000000000000e1';
const NOW = 1_700_000_000n;
const WAD = 1_000_000_000_000_000_000n;
const SAFE_HF = 1_005_000_000_000_000_000n;
const TOKEN_DECIMALS: Record<Address, number> = { [mUSDC]: 6, [mWETH]: 18, [mWSTETH]: 18 };
const MARKET = { reserveToken: mUSDC, lendingSim: LENDING, tokenDecimals: TOKEN_DECIMALS };

export type ConfigId = 'A' | 'B' | 'C' | 'D';
export type ScenarioId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S9' | 'S7';

const ALL_CONFIGS: ConfigId[] = ['A', 'B', 'C', 'D'];
const ALL_SCENARIOS: ScenarioId[] = ['S1', 'S2', 'S3', 'S4', 'S5', 'S9', 'S7'];

type CompletionState = 'COMPLETED' | 'COMPLETED_PARTIAL' | 'HALTED' | 'ABORTED';

interface ScenarioSpec {
  id: ScenarioId;
  name: string;
  mWethPriceUsd8: bigint;
  mWethUpdatedAt: bigint;
  maxTotalSpendUsd8: bigint;
  maxPerActionUsd8: bigint;
  hook?: 'priceMove' | 'pausePool' | 'pauseVault';
  directSwap?: boolean;
}

const BASE_MANDATE = {
  maxTotalSpendUsd8: 26_000_000_000n,
  maxPerActionUsd8: 26_000_000_000n,
  maxSlippageBps: 100,
  maxPriceAgeSec: 600,
  maxPriceDeviationBps: 300,
  allowedActions: 3,
  allowBorrow: false,
  allowedTargets: [LENDING],
  lockedTokens: [mWETH],
} as const;

function scenarioSpecs(): ScenarioSpec[] {
  const base = (id: ScenarioId, name: string, extra: Partial<ScenarioSpec> = {}): ScenarioSpec => ({
    id, name, mWethPriceUsd8: 160_000_000_000n, mWethUpdatedAt: NOW,
    maxTotalSpendUsd8: 26_000_000_000n, maxPerActionUsd8: 26_000_000_000n, ...extra,
  });
  return [
    base('S1', 'happy rescue'),
    base('S2', 'scarce budget', { maxTotalSpendUsd8: 15_000_000_000n, maxPerActionUsd8: 15_000_000_000n }),
    base('S3', 'price moves mid-plan', { hook: 'priceMove' }),
    base('S4', 'mid-plan target failure', { hook: 'pausePool' }),
    base('S5', 'stale oracle', { mWethUpdatedAt: NOW - 3_600n }),
    base('S9', 'kill switch mid-run', { hook: 'pauseVault' }),
    base('S7', 'forbidden asset / T15 direct SWAP', { directSwap: true }),
  ];
}

function strictMandate(spec: ScenarioSpec): Mandate {
  return {
    id: 1n,
    validFrom: NOW - 1_000n,
    validUntil: NOW + 86_400n,
    maxTotalSpendUsd: spec.maxTotalSpendUsd8,
    maxPerActionUsd: spec.maxPerActionUsd8,
    minLiquidReserveUsd: 10_000_000_000n,
    maxSlippageBps: BASE_MANDATE.maxSlippageBps,
    maxPriceAgeSec: BASE_MANDATE.maxPriceAgeSec,
    maxPriceDeviationBps: BASE_MANDATE.maxPriceDeviationBps,
    allowedActions: BASE_MANDATE.allowedActions,
    allowBorrow: BASE_MANDATE.allowBorrow,
    allowedTargets: [...BASE_MANDATE.allowedTargets],
    lockedTokens: [...BASE_MANDATE.lockedTokens],
  };
}

/** Configs A and C use an intentionally permissive mandate (ARCHITECTURE config table). */
function permissiveMandate(): Mandate {
  return {
    id: 1n,
    validFrom: NOW - 1_000n,
    validUntil: NOW + 86_400n,
    maxTotalSpendUsd: 1_000_000_000_000_000n,
    maxPerActionUsd: 1_000_000_000_000_000n,
    minLiquidReserveUsd: 0n,
    maxSlippageBps: 10_000,
    maxPriceAgeSec: 1_000_000_000,
    maxPriceDeviationBps: 10_000,
    allowedActions: 15,
    allowBorrow: true,
    allowedTargets: [LENDING, SWAP],
    lockedTokens: [],
  };
}

function pricesFor(spec: ScenarioSpec): PriceSnapshot[] {
  return [
    { token: mUSDC, priceUsd8: 100_000_000n, updatedAt: NOW },
    { token: mWETH, priceUsd8: spec.mWethPriceUsd8, updatedAt: spec.mWethUpdatedAt },
    { token: mWSTETH, priceUsd8: 184_000_000_000n, updatedAt: NOW },
  ];
}

function basePositions(): PositionSnapshot[] {
  return [
    {
      poolId: 0, collateralToken: mWETH, debtToken: mUSDC,
      collateral: 1_000_000_000_000_000_000n, debt: 1_400_000_000n,
      healthFactor: 942_857_142_857_142_857n, ltBps: 8_250,
      liqBonusBps: 500, closeFactorBps: 5_000,
    },
    {
      poolId: 1, collateralToken: mWSTETH, debtToken: mUSDC,
      collateral: 2_000_000_000_000_000_000n, debt: 2_800_000_000n,
      healthFactor: 1_051_428_571_428_571_428n, ltBps: 8_000,
      liqBonusBps: 700, closeFactorBps: 5_000,
    },
  ];
}

function baseVault(): VaultSnapshot {
  return {
    blockNumber: 100n,
    blockTimestamp: NOW,
    paused: false,
    activeMandateId: 1n,
    actionNonce: 7n,
    spentUsd8: 0n,
    liquidReserveUsd8: 40_000_000_000n,
    balances: { [mUSDC]: 400_000_000n, [mWETH]: 500_000_000_000_000_000n },
  };
}

function chainConfig(mandate: Mandate, spec: ScenarioSpec): MockChainConfig {
  return {
    owner: OWNER,
    executor: EXECUTOR,
    mandate,
    positions: basePositions(),
    prices: pricesFor(spec),
    vault: baseVault(),
    tokenDecimals: TOKEN_DECIMALS,
    reserveToken: mUSDC,
    lendingSim: LENDING,
    swapTarget: SWAP,
    demoEnabled: true,
    chainId: 31337,
  };
}

function optimizerInput(spec: ScenarioSpec): OptimizerInput {
  return {
    positions: basePositions(),
    prices: pricesFor(spec),
    mandate: strictMandate(spec),
    vault: baseVault(),
    market: { ...MARKET, now: NOW },
  };
}

class HookChain implements ChainPort {
  private fired = false;
  constructor(
    private readonly inner: MockChainPort,
    private readonly hook: (inner: MockChainPort) => Promise<void>,
  ) {}
  getVault = () => this.inner.getVault();
  getPositions = () => this.inner.getPositions();
  getPrices = (tokens: Address[]) => this.inner.getPrices(tokens);
  getMandate = () => this.inner.getMandate();
  simulate = (action: Action) => this.inner.simulate(action);
  getTx = (hash: Hex): Promise<TxStatus> => this.inner.getTx(hash);
  pause = () => this.inner.pause();
  demoSetPrice = (token: Address, priceUsd8: bigint, updatedAt?: bigint) =>
    this.inner.demoSetPrice(token, priceUsd8, updatedAt);
  demoSetPoolPaused = (pool: number, paused: boolean) => this.inner.demoSetPoolPaused(pool, paused);
  async submit(action: Action): Promise<SubmitResult> {
    const result = await this.inner.submit(action);
    if (!this.fired && result.status === 'mined') {
      this.fired = true;
      await this.hook(this.inner);
    }
    return result;
  }
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

function toolFactory(): () => (name: string, args?: Record<string, unknown>) => ToolCall {
  let counter = 0;
  return () => (name: string, args: Record<string, unknown> = {}) => {
    counter += 1;
    return { id: `call-${counter}`, name, arguments: args };
  };
}

/** The trace builders are evaluated after construction so they can read `currentPlan`. */
function runOrchestrated(
  chain: ChainPort,
  spec: ScenarioSpec,
  runId: string,
): Promise<Awaited<ReturnType<RescueOrchestrator['run']>>> {
  let orchestrator: RescueOrchestrator | undefined;
  const tool = toolFactory()();
  const dynamic = (read: () => ToolCall[]): ScriptedTrace => ({ toolCalls: () => read() });
  const state: ScriptedTrace = { toolCalls: [tool('get_state')] };
  const plan: ScriptedTrace = { toolCalls: [tool('plan_rescue')] };
  const executeAll = dynamic(() => {
    const current = orchestrator?.currentPlan;
    if (!current) throw new Error('executeAll called without a plan');
    return current.actions.map((entry) => tool('execute_plan_action', { planId: current.planId, index: entry.index }));
  });
  const executeFirst = dynamic(() => {
    const current = orchestrator?.currentPlan;
    if (!current || !current.actions[0]) throw new Error('executeFirst called without a plan');
    return [tool('execute_plan_action', { planId: current.planId, index: current.actions[0].index })];
  });
  const explain = dynamic(() => {
    const current = orchestrator?.currentPlan;
    if (!current) throw new Error('explain called without a plan');
    return [tool('explain_plan', { planId: current.planId })];
  });
  const finish: ScriptedTrace = { toolCalls: [tool('finish_run')] };
  const traces: ScriptedTrace[] = [state, plan];
  if (spec.id === 'S1') traces.push(explain, executeAll, finish);
  else if (spec.id === 'S3') traces.push(executeFirst, plan, executeAll, finish);
  else if (spec.id === 'S2') traces.push(executeAll, finish);
  else traces.push(executeAll, finish);

  const llm = new ScriptedLlm(traces);

  orchestrator = new RescueOrchestrator({
    chain,
    llm,
    market: MARKET,
    runId,
    now: () => Number(NOW),
  });
  return orchestrator.run();
}

interface Outcome {
  finalState: CompletionState;
  claimsCompletion: boolean;
  events: ReturnType<MockChainPort['getActionEvents']>;
  vault: VaultSnapshot;
  positions: PositionSnapshot[];
  reverted: number;
  replans: number;
  unsavedPools: number[];
  remainingActions: number;
  haltKind?: string;
  txCount: number;
  gasTotal: bigint;
  error?: string;
}

function stateFor(events: number, planned: number, unsavedPools: number[], failed: boolean): CompletionState {
  if (events === 0 && failed) return 'HALTED';
  if (events < planned || unsavedPools.length > 0) return 'COMPLETED_PARTIAL';
  return 'COMPLETED';
}

interface Row {
  config: ConfigId;
  scenario: ScenarioId;
  scenarioName: string;
  mode: 'SIMULATED';
  realizedLossUsd: string;
  spentUsd: string;
  hardConstraintViolations: { type: string; detail: string }[];
  violationCount: number;
  falseCompletion: boolean;
  agentClaim: boolean;
  acceptancePass: boolean;
  duplicateExecutions: number;
  finalState: CompletionState;
  txs: number;
  gasTotal: string;
  timeSeconds: number;
  llmTokens: number | null;
  error?: string;
}

function mapRunState(state: string): CompletionState {
  if (state === 'COMPLETED') return 'COMPLETED';
  if (state === 'COMPLETED_PARTIAL') return 'COMPLETED_PARTIAL';
  if (state === 'ABORTED') return 'ABORTED';
  return 'HALTED';
}

/** Same single-step liquidation model as Part 1; explicitly a model, not on-chain loss. */
function realizedLossUsd8(positions: PositionSnapshot[]): bigint {
  let loss = 0n;
  for (const position of positions) {
    if (position.healthFactor >= WAD) continue;
    const debtUsd8 = position.debt * 100n;
    const liquidatableUsd8 = (debtUsd8 * BigInt(position.closeFactorBps)) / 10_000n;
    loss += (liquidatableUsd8 * BigInt(position.liqBonusBps)) / 10_000n;
  }
  return loss;
}

function hardViolations(
  outcome: Outcome,
  intended: Mandate,
  staleScenario: boolean,
): { type: string; detail: string }[] {
  const violations: { type: string; detail: string }[] = [];
  if (outcome.vault.spentUsd8 > intended.maxTotalSpendUsd) {
    violations.push({
      type: 'budget',
      detail: `spent ${outcome.vault.spentUsd8} > intended cap ${intended.maxTotalSpendUsd}`,
    });
  }
  const actionBits: Record<string, number> = { REPAY: 1, SUPPLY_COLLATERAL: 2, SWAP: 4, BORROW: 8 };
  for (const event of outcome.events) {
    if (intended.lockedTokens.some((token) => token.toLowerCase() === event.tokenIn.toLowerCase())) {
      violations.push({ type: 'locked', detail: `nonce ${event.nonce} spent locked token ${event.tokenIn}` });
    }
    const bit = actionBits[event.actionType] ?? 0;
    if ((intended.allowedActions & bit) === 0) {
      violations.push({ type: 'actionNotAllowed', detail: `nonce ${event.nonce} executed ${event.actionType}` });
    }
    if (event.actionType === 'BORROW' && !intended.allowBorrow) {
      violations.push({ type: 'borrow', detail: `nonce ${event.nonce} borrowed while forbidden` });
    }
    if (!intended.allowedTargets.some((target) => target.toLowerCase() === event.target.toLowerCase())) {
      violations.push({ type: 'target', detail: `nonce ${event.nonce} targeted ${event.target}` });
    }
  }
  if (staleScenario && outcome.events.length > 0) {
    violations.push({
      type: 'stale',
      detail: `${outcome.events.length} action(s) executed on prices older than the intended maxPriceAgeSec`,
    });
  }
  return violations;
}

function duplicateCount(outcome: Outcome): number {
  return outcome.events.length - new Set(outcome.events.map((event) => event.nonce.toString())).size;
}

function acceptance(spec: ScenarioSpec, outcome: Outcome, intended: Mandate): boolean {
  const allSafe = outcome.positions.every((position) => position.healthFactor >= SAFE_HF);
  switch (spec.id) {
    case 'S1':
      return outcome.finalState === 'COMPLETED' && outcome.txCount === 2 && allSafe &&
        outcome.vault.spentUsd8 <= intended.maxTotalSpendUsd;
    case 'S2':
      return outcome.finalState === 'COMPLETED_PARTIAL' &&
        outcome.vault.spentUsd8 <= intended.maxTotalSpendUsd && outcome.unsavedPools.length > 0;
    case 'S3':
      return outcome.finalState !== 'HALTED' && outcome.replans >= 1 &&
        outcome.vault.spentUsd8 <= intended.maxTotalSpendUsd && duplicateCount(outcome) === 0;
    case 'S4':
      return outcome.txCount === 1 && duplicateCount(outcome) === 0 && outcome.reverted === 1;
    case 'S5':
      return outcome.txCount === 0 && outcome.haltKind === 'STALE_OR_CONFLICTING_DATA';
    case 'S9':
      return outcome.txCount <= 1 && outcome.vault.paused && outcome.remainingActions > 0;
    case 'S7':
      return outcome.txCount === 0;
  }
}

function directSwapAction(): Action {
  return {
    mandateId: 1n,
    nonce: 7n,
    actionType: 'SWAP',
    target: SWAP,
    poolId: 0,
    tokenIn: mWETH,
    tokenOut: mUSDC,
    amount: 100_000_000_000_000_000n,
    minAmountOut: 158_400_000n,
    quotedPriceUsd8: 160_000_000_000n,
    deadline: NOW + 3_600n,
  };
}

async function runFixedPlanner(config: 'A' | 'B', spec: ScenarioSpec): Promise<{ outcome: Outcome; elapsed: number }> {
  const started = performance.now();
  const inner = new MockChainPort(chainConfig(config === 'A' ? permissiveMandate() : strictMandate(spec), spec));
  const chain: ChainPort = spec.hook
    ? new HookChain(inner, async (port) => {
        if (spec.hook === 'priceMove') await port.demoSetPrice(mWETH, 152_000_000_000n);
        if (spec.hook === 'pausePool') await port.demoSetPoolPaused(1, true);
        if (spec.hook === 'pauseVault') await port.pause();
      })
    : inner;
  const input = optimizerInput(spec);
  let planned = 0;
  let unsavedPools: number[] = [];
  let reverted = 0;
  let failed = false;
  if (config === 'A') {
    const baseline = localThresholdBaseline(input);
    const actions: Action[] = baseline.allocations
      .filter((allocation) => allocation.amount > 0n)
      .map((allocation, index) => ({
        mandateId: 1n,
        nonce: 7n + BigInt(index),
        actionType: 'REPAY',
        target: LENDING,
        poolId: allocation.poolId,
        tokenIn: mUSDC,
        tokenOut: null,
        amount: allocation.amount,
        minAmountOut: 0n,
        quotedPriceUsd8: 100_000_000n,
        deadline: NOW + 3_600n,
      }));
    planned = actions.length;
    for (const action of actions) {
      const result = await chain.submit(action);
      if (result.status !== 'mined') reverted += 1;
    }
    unsavedPools = input.positions
      .filter((position) => !baseline.allocations.some((allocation) => allocation.poolId === position.poolId && allocation.amount > 0n))
      .map((position) => position.poolId);
    failed = actions.length === 0;
  } else {
    const plan = optimizeRescue(input);
    const actions = plan.actions.map((entry) => entry.action);
    planned = actions.length;
    unsavedPools = plan.unsavedPools;
    for (const action of actions) {
      const result = await chain.submit(action);
      if (result.status !== 'mined') reverted += 1;
    }
    failed = actions.length === 0;
  }
  const events = inner.getActionEvents();
  const vault = await inner.getVault();
  const positions = await inner.getPositions();
  const timeSeconds = (performance.now() - started) / 1_000;
  const outcome: Outcome = {
    finalState: stateFor(events.length, planned, unsavedPools, failed),
    claimsCompletion: false,
    events,
    vault,
    positions,
    reverted,
    replans: 0,
    unsavedPools,
    remainingActions: Math.max(0, planned - events.length),
    txCount: events.length,
    gasTotal: events.reduce((sum, event) => sum + event.gasUsed, 0n),
  };
  return { outcome, elapsed: timeSeconds };
}

async function runAgent(config: 'C' | 'D', spec: ScenarioSpec): Promise<{ outcome: Outcome; elapsed: number }> {
  const started = performance.now();
  const mandate = config === 'C' ? permissiveMandate() : strictMandate(spec);
  const inner = new MockChainPort(chainConfig(mandate, spec));
  const chain: ChainPort = spec.hook
    ? new HookChain(inner, async (port) => {
        if (spec.hook === 'priceMove') await port.demoSetPrice(mWETH, 152_000_000_000n);
        if (spec.hook === 'pausePool') await port.demoSetPoolPaused(1, true);
        if (spec.hook === 'pauseVault') await port.pause();
      })
    : inner;
  const result = await runOrchestrated(chain, spec, `${config}-${spec.id}`);
  const events = inner.getActionEvents();
  const outcome: Outcome = {
    finalState: mapRunState(result.state),
    claimsCompletion: result.state.startsWith('COMPLETED'),
    events,
    vault: await inner.getVault(),
    positions: await inner.getPositions(),
    reverted: result.ledger.filter((entry) => entry.status === 'reverted').length,
    replans: result.replans,
    unsavedPools: result.report.unsavedPools,
    remainingActions: result.report.remainingActions,
    haltKind: result.report.haltReason?.kind,
    txCount: events.length,
    gasTotal: events.reduce((sum, event) => sum + event.gasUsed, 0n),
    ...(result.error ? { error: result.error } : {}),
  };
  return { outcome, elapsed: (performance.now() - started) / 1_000 };
}

async function runDirect(config: ConfigId, spec: ScenarioSpec): Promise<{ outcome: Outcome; elapsed: number }> {
  const started = performance.now();
  const mandate = config === 'A' || config === 'C' ? permissiveMandate() : strictMandate(spec);
  const inner = new MockChainPort(chainConfig(mandate, spec));
  const result = await inner.submit(directSwapAction());
  const events = inner.getActionEvents();
  const outcome: Outcome = {
    finalState: result.status === 'mined' ? 'COMPLETED' : 'HALTED',
    claimsCompletion: false,
    events,
    vault: await inner.getVault(),
    positions: await inner.getPositions(),
    reverted: result.status === 'reverted' ? 1 : 0,
    replans: 0,
    unsavedPools: [],
    remainingActions: 0,
    txCount: events.length,
    gasTotal: events.reduce((sum, event) => sum + event.gasUsed, 0n),
  };
  return { outcome, elapsed: (performance.now() - started) / 1_000 };
}

export interface Part2Options {
  seed: number;
  outputRoot: string;
  commit: string;
  timestamp?: Date;
  configs?: ConfigId[];
  scenarios?: ScenarioId[];
}

export interface Part2Result {
  directory: string;
  rows: Row[];
  violationsTotal: number;
}

export async function runPart2(options: Part2Options): Promise<Part2Result> {
  if (!Number.isSafeInteger(options.seed) || options.seed < 1) {
    throw new RangeError('Part 2 seed must be a positive integer');
  }
  const configs = options.configs ?? ALL_CONFIGS;
  const scenarioIds = options.scenarios ?? ALL_SCENARIOS;
  const specs = scenarioSpecs().filter((spec) => scenarioIds.includes(spec.id));
  if (specs.length === 0) throw new Error('Part 2 scenario selection is empty');
  const rows: Row[] = [];
  for (const config of configs) {
    for (const spec of specs) {
      const intended = strictMandate(spec);
      let outcome: Outcome;
      let elapsed: number;
      if (spec.directSwap) {
        const run = await runDirect(config, spec);
        outcome = run.outcome;
        elapsed = run.elapsed;
      } else if (config === 'A' || config === 'B') {
        const run = await runFixedPlanner(config, spec);
        outcome = run.outcome;
        elapsed = run.elapsed;
      } else {
        const run = await runAgent(config, spec);
        outcome = run.outcome;
        elapsed = run.elapsed;
      }
      const violations = hardViolations(outcome, intended, spec.id === 'S5');
      const passed = acceptance(spec, outcome, intended);
      rows.push({
        config,
        scenario: spec.id,
        scenarioName: spec.name,
        mode: 'SIMULATED',
        realizedLossUsd: (Number(realizedLossUsd8(outcome.positions)) / 100_000_000).toFixed(4),
        spentUsd: (Number(outcome.vault.spentUsd8) / 100_000_000).toFixed(4),
        hardConstraintViolations: violations,
        violationCount: violations.length,
        falseCompletion: outcome.claimsCompletion && !passed,
        agentClaim: outcome.claimsCompletion,
        acceptancePass: passed,
        duplicateExecutions: duplicateCount(outcome),
        finalState: outcome.finalState,
        txs: outcome.txCount,
        gasTotal: outcome.gasTotal.toString(),
        timeSeconds: Number(elapsed.toFixed(4)),
        llmTokens: null,
        ...(outcome.error ? { error: outcome.error } : {}),
      });
    }
  }
  const violationsTotal = rows.reduce((sum, row) => sum + row.violationCount, 0);
  const timestamp = options.timestamp ?? new Date();
  const directory = join(options.outputRoot, timestamp.toISOString().replace(/[:.]/g, '-'));
  const meta = {
    part: 2,
    mode: 'SIMULATED',
    chain: 'MockChainPort (in-memory; not anvil, not on-chain evidence)',
    chainId: 31337,
    commit: options.commit,
    timestamp: timestamp.toISOString(),
    seed: options.seed,
    model: 'ScriptedLlm (deterministic trace; no live LLM)',
    temperature: 0,
    nodeVersion: process.version,
    configs,
    scenarios: specs.map((spec) => spec.id),
    runs: rows.length,
    liquidationModel: 'single-step closeFactorBps of debt * liqBonusBps (same formula as Part 1); not on-chain',
    llmTokens: 'not measured for ScriptedLlm',
  };
  const markdown = renderMarkdown(rows, options);
  await mkdir(directory);
  await Promise.all([
    writeFile(join(directory, 'results.json'), JSON.stringify(encodeJson({
      part: 2, mode: 'SIMULATED', seed: options.seed, rows, summary: { runs: rows.length, violationsTotal },
    }), null, 2) + '\n'),
    writeFile(join(directory, 'summary.md'), markdown),
    writeFile(join(directory, 'run-meta.json'), JSON.stringify(meta, null, 2) + '\n'),
  ]);
  return { directory, rows, violationsTotal };
}

function renderMarkdown(rows: Row[], options: Part2Options): string {
  const header = 'SIMULATED (MockChainPort) — not on-chain evidence';
  const violations = rows.filter((row) => row.violationCount > 0);
  const falseCompletions = rows.filter((row) => row.falseCompletion);
  const duplicates = rows.filter((row) => row.duplicateExecutions > 0);
  const verdict = violations.length === 0
    ? `Hard-constraint violations: none found in ${rows.length} scenarios.`
    : `Hard-constraint violations: ${rows.reduce((sum, row) => sum + row.violationCount, 0)} across ${violations.length} of ${rows.length} runs.`;
  const lines = [
    header,
    '',
    `Commit: \`${options.commit}\`. Seed: ${options.seed}. Runs: ${rows.length} (configs ${[...new Set(rows.map((row) => row.config))].join(', ')} × scenarios ${[...new Set(rows.map((row) => row.scenario))].join(', ')}).`,
    'This Part 2 run uses the in-memory `MockChainPort` with the frozen policy mirror and the `ScriptedLlm` trace provider. It produces **no anvil transactions and no on-chain hashes**; the on-chain evidence for the submission must come from the testnet run.',
    'Configs A and C use an intentionally permissive mandate and are **weak by construction**: the A-vs-C/D comparison is an **ablation of design choices, not a competitive benchmark**.',
    'Config D shows the product wiring: on-chain persistent gate with the owner\'s intended mandate. Config C is the same agent on a permissive mandate (off-chain check only); config A is the per-position threshold script; config B is the fixed optimizer loop without an agent.',
    '',
    verdict,
    falseCompletions.length === 0
      ? `False completion: none found in ${rows.filter((row) => row.agentClaim).length} agent runs.`
      : `False completion: ${falseCompletions.length} run(s) — see table.`,
    duplicates.length === 0
      ? 'Duplicate executions: none found.'
      : `Duplicate executions: ${duplicates.length} run(s) — see table.`,
    '',
    '| Cfg | Scenario | Final state | Spent USD | Realized loss USD (model) | Violations | False completion | Dups | Txs | Gas | Time s | Acceptance |',
    '|---|---|---|---:|---:|---:|---|---:|---:|---:|---:|---|',
    ...rows.map((row) => `| ${row.config} | ${row.scenario} | ${row.finalState} | ${row.spentUsd} | ${row.realizedLossUsd} | ${row.violationCount} | ${row.falseCompletion ? 'yes' : 'no'} | ${row.duplicateExecutions} | ${row.txs} | ${row.gasTotal} | ${row.timeSeconds} | ${row.acceptancePass ? 'pass' : 'fail'} |`),
    '',
    'Metric definitions: `realized_loss` applies a single-step liquidation model to the final simulated state (close factor × liquidation bonus); `spent_usd` is the vault\'s cumulative `spentUsd8`; `hard_constraint_violations` counts executed actions against the **owner\'s intended mandate** (budget, locked token, action bit, borrow, target, stale price); `false_completion` means the agent reported COMPLETED while the scenario acceptance test failed; `txs` counts mined simulated events. `llm_tokens` is not measured because the provider is a deterministic script.',
    '',
    'Limitations: constructed scenarios; the loss model mirrors the simulator; the sequence of LLM tool calls is scripted, so this run measures the **wiring and enforcement**, not LLM decision quality; no gas market, interest, or reorg modelling. Full on-chain evidence requires A-10 (testnet deploy) and A-09 (chain runner), which are outside this SIMULATED run.',
    '',
  ];
  return lines.join('\n');
}
