import { describe, expect, test } from 'vitest';

import {
  MockChainPort,
  type Action,
  type Address,
  type ChainPort,
  type Mandate,
  type MockChainConfig,
  type PositionSnapshot,
  type PriceSnapshot,
  type SubmitResult,
  type TxStatus,
  type VaultSnapshot,
} from '@marginpilot/core';

import { ScriptedLlm } from '../src/llm/scripted.js';
import { RescueOrchestrator } from '../src/orchestrator.js';
import { TOOL_NAMES } from '../src/tools.js';

const A: Record<string, Address> = {
  mUSDC: '0x00000000000000000000000000000000000000a1',
  mWETH: '0x00000000000000000000000000000000000000a2',
  mWSTETH: '0x00000000000000000000000000000000000000a3',
  lending: '0x00000000000000000000000000000000000000b1',
  vault: '0x00000000000000000000000000000000000000b2',
  swap: '0x00000000000000000000000000000000000000b3',
};
const OWNER: Address = '0x00000000000000000000000000000000000000e3';
const EXECUTOR: Address = '0x00000000000000000000000000000000000000e1';
const NOW = 1_700_000_000n;
const BLOCK = 100n;
const TOKEN_DECIMALS: Record<Address, number> = {
  [A.mUSDC as Address]: 6,
  [A.mWETH as Address]: 18,
  [A.mWSTETH as Address]: 18,
};

const prices = (): PriceSnapshot[] => [
  { token: A.mUSDC as Address, priceUsd8: 100_000_000n, updatedAt: NOW },
  { token: A.mWETH as Address, priceUsd8: 160_000_000_000n, updatedAt: NOW },
  { token: A.mWSTETH as Address, priceUsd8: 184_000_000_000n, updatedAt: NOW },
];

const positions = (): PositionSnapshot[] => [
  {
    poolId: 0,
    collateralToken: A.mWETH as Address,
    debtToken: A.mUSDC as Address,
    collateral: 1_000_000_000_000_000_000n,
    debt: 1_400_000_000n,
    healthFactor: 942_857_142_857_142_857n,
    ltBps: 8_250,
    liqBonusBps: 500,
    closeFactorBps: 5_000,
  },
  {
    poolId: 1,
    collateralToken: A.mWSTETH as Address,
    debtToken: A.mUSDC as Address,
    collateral: 2_000_000_000_000_000_000n,
    debt: 2_800_000_000n,
    healthFactor: 1_051_428_571_428_571_428n,
    ltBps: 8_000,
    liqBonusBps: 700,
    closeFactorBps: 5_000,
  },
];

const mandate = (overrides: Partial<Mandate> = {}): Mandate => ({
  id: 1n,
  validFrom: NOW - 1_000n,
  validUntil: NOW + 86_400n,
  maxTotalSpendUsd: 26_000_000_000n,
  maxPerActionUsd: 26_000_000_000n,
  minLiquidReserveUsd: 10_000_000_000n,
  maxSlippageBps: 100,
  maxPriceAgeSec: 600,
  maxPriceDeviationBps: 300,
  allowedActions: 3,
  allowBorrow: false,
  allowedTargets: [A.lending as Address],
  lockedTokens: [A.mWETH as Address],
  ...overrides,
});

const vault = (overrides: Partial<VaultSnapshot> = {}): VaultSnapshot => ({
  blockNumber: BLOCK,
  blockTimestamp: NOW,
  paused: false,
  activeMandateId: 1n,
  actionNonce: 7n,
  spentUsd8: 0n,
  liquidReserveUsd8: 40_000_000_000n,
  balances: {
    [A.mUSDC as Address]: 400_000_000n,
    [A.mWETH as Address]: 500_000_000_000_000_000n,
  },
  ...overrides,
});

function chainConfig(overrides: Partial<MockChainConfig> = {}): MockChainConfig {
  return {
    owner: OWNER,
    executor: EXECUTOR,
    mandate: mandate(),
    positions: positions(),
    prices: prices(),
    vault: vault(),
    tokenDecimals: TOKEN_DECIMALS,
    reserveToken: A.mUSDC as Address,
    lendingSim: A.lending as Address,
    swapTarget: A.swap as Address,
    demoEnabled: true,
    chainId: 31337,
    ...overrides,
  };
}

const MARKET = {
  reserveToken: A.mUSDC as Address,
  lendingSim: A.lending as Address,
  tokenDecimals: TOKEN_DECIMALS,
};

let callCounter = 0;
function tool(name: string, args: Record<string, unknown> = {}): {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
} {
  callCounter += 1;
  return { id: `call-${callCounter}`, name, arguments: args };
}

type Trace = {
  toolCalls:
    | ReturnType<typeof tool>[]
    | (() => ReturnType<typeof tool>[]);
};

function step(...calls: ReturnType<typeof tool>[]): Trace {
  return { toolCalls: calls };
}

function runTrace(getState = true): Trace[] {
  return getState ? [step(tool('get_state')), step(tool('plan_rescue'))] : [step(tool('plan_rescue'))];
}

function executeAll(orch?: RescueOrchestrator): Trace {
  return {
    toolCalls: () => {
      const plan = (orch ?? activeOrchestrator)?.currentPlan;
      if (!plan) throw new Error('executeAll called without a plan');
      return plan.actions.map((entry) =>
        tool('execute_plan_action', { planId: plan.planId, index: entry.index }),
      );
    },
  };
}

function executeOne(orch: RescueOrchestrator | undefined, index: number): Trace {
  return {
    toolCalls: () => {
      const plan = (orch ?? activeOrchestrator)?.currentPlan;
      if (!plan) throw new Error('executeOne called without a plan');
      return [tool('execute_plan_action', { planId: plan.planId, index })];
    },
  };
}

function explainCurrent(orch?: RescueOrchestrator): Trace {
  return {
    toolCalls: () => {
      const plan = (orch ?? activeOrchestrator)?.currentPlan;
      if (!plan) throw new Error('explain called without a plan');
      return [tool('explain_plan', { planId: plan.planId })];
    },
  };
}

let activeOrchestrator: RescueOrchestrator | undefined;

function orchestrator(chain: ChainPort, traces: Trace[] | ScriptedLlm): RescueOrchestrator {
  const created = new RescueOrchestrator({
    chain,
    llm: traces instanceof ScriptedLlm ? traces : new ScriptedLlm(traces),
    market: MARKET,
    runId: 'test-run',
    now: () => Number(NOW),
  });
  activeOrchestrator = created;
  return created;
}

class ShockAfterFirstMined implements ChainPort {
  private shocked = false;
  constructor(private readonly inner: MockChainPort) {}
  getVault = () => this.inner.getVault();
  getPositions = () => this.inner.getPositions();
  getPrices = (tokens: Address[]) => this.inner.getPrices(tokens);
  getMandate = () => this.inner.getMandate();
  simulate = (action: Action) => this.inner.simulate(action);
  getTx = (hash: `0x${string}`): Promise<TxStatus> => this.inner.getTx(hash);
  pause = () => this.inner.pause();
  demoSetPrice = (token: Address, value: bigint, updatedAt?: bigint) =>
    this.inner.demoSetPrice(token, value, updatedAt);
  demoSetPoolPaused = (pool: number, paused: boolean) => this.inner.demoSetPoolPaused(pool, paused);
  async submit(action: Action): Promise<SubmitResult> {
    const result = await this.inner.submit(action);
    if (!this.shocked && result.status === 'mined') {
      this.shocked = true;
      await this.inner.demoSetPrice(A.mWETH as Address, 152_000_000_000n);
    }
    return result;
  }
}

/** Serves a mandate whose id does not match the vault's active mandate. */
class MismatchedMandateChain implements ChainPort {
  constructor(private readonly inner: MockChainPort) {}

  getVault = () => this.inner.getVault();
  getPositions = () => this.inner.getPositions();
  getPrices = (tokens: Address[]) => this.inner.getPrices(tokens);
  async getMandate(): Promise<Mandate | null> {
    const mandate = await this.inner.getMandate();
    return mandate === null ? null : { ...mandate, id: mandate.id + 98n };
  }
  simulate = (action: Action) => this.inner.simulate(action);
  getTx = (hash: `0x${string}`): Promise<TxStatus> => this.inner.getTx(hash);
  pause = () => this.inner.pause();
  demoSetPrice = (token: Address, value: bigint, updatedAt?: bigint) =>
    this.inner.demoSetPrice(token, value, updatedAt);
  demoSetPoolPaused = (pool: number, paused: boolean) => this.inner.demoSetPoolPaused(pool, paused);
  submit = (action: Action) => this.inner.submit(action);
}

/**
 * Serves the pre-action state for the first read after a mined action, the way
 * a load-balanced RPC node can answer with a lagging state.
 */
class LaggingReadChain implements ChainPort {
  private staleVault?: VaultSnapshot;
  private stalePositions?: PositionSnapshot[];

  constructor(private readonly inner: MockChainPort) {}

  async getVault(): Promise<VaultSnapshot> {
    if (this.staleVault) {
      const stale = this.staleVault;
      this.staleVault = undefined;
      return stale;
    }
    return this.inner.getVault();
  }

  async getPositions(): Promise<PositionSnapshot[]> {
    if (this.stalePositions) {
      const stale = this.stalePositions;
      this.stalePositions = undefined;
      return stale;
    }
    return this.inner.getPositions();
  }

  getPrices = (tokens: Address[]) => this.inner.getPrices(tokens);
  getMandate = () => this.inner.getMandate();
  simulate = (action: Action) => this.inner.simulate(action);
  getTx = (hash: `0x${string}`): Promise<TxStatus> => this.inner.getTx(hash);
  pause = () => this.inner.pause();
  demoSetPrice = (token: Address, value: bigint, updatedAt?: bigint) =>
    this.inner.demoSetPrice(token, value, updatedAt);
  demoSetPoolPaused = (pool: number, paused: boolean) => this.inner.demoSetPoolPaused(pool, paused);

  async submit(action: Action): Promise<SubmitResult> {
    const beforeVault = await this.inner.getVault();
    const beforePositions = await this.inner.getPositions();
    const result = await this.inner.submit(action);
    if (result.status === 'mined') {
      this.staleVault = beforeVault;
      this.stalePositions = beforePositions;
    }
    return result;
  }
}

class PausePoolAfterFirstMined implements ChainPort {  private changed = false;
  constructor(private readonly inner: MockChainPort) {}
  getVault = () => this.inner.getVault();
  getPositions = () => this.inner.getPositions();
  getPrices = (tokens: Address[]) => this.inner.getPrices(tokens);
  getMandate = () => this.inner.getMandate();
  simulate = (action: Action) => this.inner.simulate(action);
  getTx = (hash: `0x${string}`): Promise<TxStatus> => this.inner.getTx(hash);
  pause = () => this.inner.pause();
  demoSetPrice = (token: Address, value: bigint, updatedAt?: bigint) =>
    this.inner.demoSetPrice(token, value, updatedAt);
  demoSetPoolPaused = (pool: number, paused: boolean) => this.inner.demoSetPoolPaused(pool, paused);
  async submit(action: Action): Promise<SubmitResult> {
    const result = await this.inner.submit(action);
    if (!this.changed && result.status === 'mined') {
      this.changed = true;
      await this.inner.demoSetPoolPaused(1, true);
    }
    return result;
  }
}

class PauseVaultAfterFirstMined implements ChainPort {
  private paused = false;
  constructor(private readonly inner: MockChainPort) {}
  getVault = () => this.inner.getVault();
  getPositions = () => this.inner.getPositions();
  getPrices = (tokens: Address[]) => this.inner.getPrices(tokens);
  getMandate = () => this.inner.getMandate();
  simulate = (action: Action) => this.inner.simulate(action);
  getTx = (hash: `0x${string}`): Promise<TxStatus> => this.inner.getTx(hash);
  pause = () => this.inner.pause();
  demoSetPrice = (token: Address, value: bigint, updatedAt?: bigint) =>
    this.inner.demoSetPrice(token, value, updatedAt);
  demoSetPoolPaused = (pool: number, paused: boolean) => this.inner.demoSetPoolPaused(pool, paused);
  async submit(action: Action): Promise<SubmitResult> {
    const result = await this.inner.submit(action);
    if (!this.paused && result.status === 'mined') {
      this.paused = true;
      await this.inner.pause();
    }
    return result;
  }
}

describe('closed tool set', () => {
  test('contains only the AGENT-DESIGN tools, with no mandate or free-form funds tool', () => {
    expect([...TOOL_NAMES]).toEqual([
      'get_state',
      'get_run_history',
      'compile_mandate',
      'plan_rescue',
      'explain_plan',
      'execute_plan_action',
      'pause_vault',
      'halt_and_ask_owner',
      'finish_run',
    ]);
    expect(TOOL_NAMES).not.toContain('set_mandate');
    expect(TOOL_NAMES).not.toContain('send_funds');
    expect(TOOL_NAMES).not.toContain('arbitrary_call');
  });
});

describe('B-09 scenarios on MockChainPort (SIMULATED)', () => {
  test('S1 happy rescue: two gated repays, both HFs >= 1.005, report matches chain', async () => {
    const chain = new MockChainPort(chainConfig());
    let orch!: RescueOrchestrator;
    const llm = new ScriptedLlm([
      ...runTrace(),
      explainCurrent(orch),
      executeAll(orch),
      step(tool('finish_run')),
    ]);
    orch = orchestrator(chain, llm as never);
    const result = await orch.run();
    const finalVault = await chain.getVault();
    const finalPositions = await chain.getPositions();
    const events = chain.getActionEvents();

    expect(result.state).toBe('COMPLETED');
    expect(finalVault.spentUsd8).toBeLessThanOrEqual(26_000_000_000n);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.nonce)).toEqual([7n, 8n]);
    expect(finalPositions.every((position) => position.healthFactor >= 1_005_000_000_000_000_000n)).toBe(true);
    expect(result.report.spentUsd8).toBe(finalVault.spentUsd8);
    expect(result.report.actionsMined).toBe(events.length);
    expect(result.report.healthFactors).toEqual(
      finalPositions.map((position) => ({ poolId: position.poolId, healthFactor: position.healthFactor })),
    );
    expect(result.ledger).toHaveLength(2);
    expect(result.ledger.every((entry) => entry.status === 'mined' && entry.spendUsd8 > 0n)).toBe(true);
    const kinds = new Set(result.audit.map((entry) => entry.kind));
    for (const kind of [
      'observe',
      'plan',
      'plan.explained',
      'action.validated',
      'action.submitted',
      'action.mined',
      'llm.response',
      'report',
    ]) {
      expect(kinds.has(kind), kind).toBe(true);
    }
    const llmEntries = result.audit.filter((entry) => entry.kind === 'llm.response');
    expect(llmEntries.length).toBeGreaterThan(0);
    expect(llmEntries[0]?.data).toMatchObject({
      model: 'scripted-local',
      temperature: 0,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      toolCalls: 1,
    });
    const explained = result.audit.find((entry) => entry.kind === 'plan.explained');
    const explanation = (explained?.data as { text?: string } | undefined)?.text ?? '';
    expect(explanation).toContain('pool 0');
    expect(explanation).toContain('HF');
    expect(explanation).toContain('$86.57');
  });

  test('S2 scarce budget: spends <= 150, reports COMPLETED_PARTIAL and names an unsaved pool', async () => {
    const chain = new MockChainPort(
      chainConfig({ mandate: mandate({ maxTotalSpendUsd: 15_000_000_000n, maxPerActionUsd: 15_000_000_000n }) }),
    );
    let orch!: RescueOrchestrator;
    const llm = new ScriptedLlm([...runTrace(), executeAll(orch), step(tool('finish_run'))]);
    orch = orchestrator(chain, llm as never);
    const result = await orch.run();
    const finalVault = await chain.getVault();

    expect(result.state).toBe('COMPLETED_PARTIAL');
    expect(finalVault.spentUsd8).toBeLessThanOrEqual(15_000_000_000n);
    expect(result.report.unsavedPools.length).toBeGreaterThan(0);
    expect(result.report.summary.toLowerCase()).toContain('unsaved');
    expect(result.ledger.filter((entry) => entry.status === 'reverted')).toHaveLength(0);
    expect(result.plan?.unsavedPools.length).toBeGreaterThan(0);
  });

  test('S3 price moves after action 1: replans with remaining budget, spend not reset', async () => {
    const inner = new MockChainPort(chainConfig());
    const chain = new ShockAfterFirstMined(inner);
    let orch!: RescueOrchestrator;
    const llm = new ScriptedLlm([
      ...runTrace(),
      executeOne(orch, 0),
      step(tool('plan_rescue')),
      executeAll(orch),
      step(tool('finish_run')),
    ]);
    orch = orchestrator(chain, llm as never);
    const result = await orch.run();
    const finalVault = await inner.getVault();

    expect(result.replans).toBe(1);
    expect(result.replans).toBeLessThanOrEqual(3);
    expect(finalVault.spentUsd8).toBeLessThanOrEqual(26_000_000_000n);
    expect(result.ledger.reduce((sum, entry) => sum + entry.spendUsd8, 0n)).toBe(finalVault.spentUsd8);
    expect(result.audit.some((entry) => entry.kind === 'replan')).toBe(true);
    expect(inner.getActionEvents().length).toBeGreaterThanOrEqual(2);
    expect(inner.stats.submissions).toBe(inner.getActionEvents().length);
  });

  test('S4 mid-plan target failure: simulate fails, no tx, ledger 0 spend, halted with report', async () => {
    const inner = new MockChainPort(chainConfig());
    const chain = new PausePoolAfterFirstMined(inner);
    let orch!: RescueOrchestrator;
    const llm = new ScriptedLlm([...runTrace(), executeAll(orch)]);
    orch = orchestrator(chain, llm as never);
    const result = await orch.run();

    expect(result.state).toBe('HALTED_NEEDS_OWNER');
    expect(inner.getActionEvents()).toHaveLength(1);
    expect(inner.stats.submissions).toBe(1);
    const rejected = result.ledger.filter((entry) => entry.status === 'reverted');
    expect(rejected.length).toBe(1);
    expect(rejected[0]?.spendUsd8).toBe(0n);
    expect(new Set(inner.getActionEvents().map((event) => event.nonce)).size).toBe(1);
    expect(result.report.haltReason).toBeDefined();
    expect(result.report.remainingActions).toBeGreaterThan(0);
  });

  test('S5 stale oracle: StalePrice blocks execution, zero transactions, halt recorded', async () => {
    const stalePrices = prices().map((price) =>
      price.token === A.mWETH ? { ...price, updatedAt: NOW - 3_600n } : price,
    );
    const chain = new MockChainPort(chainConfig({ prices: stalePrices }));
    let orch!: RescueOrchestrator;
    const llm = new ScriptedLlm([...runTrace(), executeAll(orch)]);
    orch = orchestrator(chain, llm as never);
    const result = await orch.run();

    expect(result.state).toBe('HALTED_NEEDS_OWNER');
    expect(chain.getActionEvents()).toEqual([]);
    expect(chain.stats.submissions).toBe(0);
    expect(result.ledger.every((entry) => entry.spendUsd8 === 0n)).toBe(true);
    expect(result.report.haltReason?.kind).toBe('STALE_OR_CONFLICTING_DATA');
    expect(result.audit.some((entry) => entry.kind === 'halt')).toBe(true);
  });

  test('S9 kill switch mid-run: pause after action 1, no action after pause, report remainder', async () => {
    const inner = new MockChainPort(chainConfig());
    const chain = new PauseVaultAfterFirstMined(inner);
    let orch!: RescueOrchestrator;
    const llm = new ScriptedLlm([...runTrace(), executeAll(orch)]);
    orch = orchestrator(chain, llm as never);
    const result = await orch.run();

    expect(result.state).toBe('HALTED_NEEDS_OWNER');
    expect((await inner.getVault()).paused).toBe(true);
    expect(inner.getActionEvents()).toHaveLength(1);
    expect(inner.stats.submissions).toBe(1);
    expect(result.ledger.filter((entry) => entry.status === 'reverted').every((entry) => entry.spendUsd8 === 0n)).toBe(true);
    expect(result.report.haltReason?.kind).toBe('PAUSED');
    expect(result.report.remainingActions).toBeGreaterThan(0);
  });

  test('S7/T15 config D rejects direct SWAP; permissive C wiring mines (SIMULATED ablation)', async () => {
    const swap: Action = {
      mandateId: 1n,
      nonce: 7n,
      actionType: 'SWAP',
      target: A.swap as Address,
      poolId: 0,
      tokenIn: A.mWETH as Address,
      tokenOut: A.mUSDC as Address,
      amount: 100_000_000_000_000_000n,
      minAmountOut: 158_400_000n,
      quotedPriceUsd8: 160_000_000_000n,
      deadline: NOW + 120n,
    };

    const d = new MockChainPort(chainConfig());
    expect(await d.simulate(swap)).toMatchObject({ ok: false, error: 'ActionNotAllowed' });
    expect(await d.submit(swap)).toMatchObject({ status: 'reverted', error: 'ActionNotAllowed' });
    expect((await d.getVault()).spentUsd8).toBe(0n);

    const dSwapAllowedLocked = new MockChainPort(
      chainConfig({ mandate: mandate({ allowedActions: 7, allowedTargets: [A.lending as Address, A.swap as Address] }) }),
    );
    expect(await dSwapAllowedLocked.simulate(swap)).toMatchObject({ ok: false, error: 'AssetLocked' });

    const c = new MockChainPort(
      chainConfig({
        mandate: mandate({
          maxTotalSpendUsd: 100_000_000_000n,
          maxPerActionUsd: 100_000_000_000n,
          minLiquidReserveUsd: 0n,
          allowedActions: 7,
          allowedTargets: [A.lending as Address, A.swap as Address],
          lockedTokens: [],
        }),
      }),
    );
    const mined = await c.submit(swap);
    expect(mined.status).toBe('mined');
    expect((await c.getVault()).spentUsd8).toBe(16_000_000_000n);
  });

  test('plan binding rejects a wrong plan id without submitting', async () => {
    const chain = new MockChainPort(chainConfig());
    let orch!: RescueOrchestrator;
    const llm = new ScriptedLlm([
      ...runTrace(),
      {
        toolCalls: () => [tool('execute_plan_action', { planId: '0xdeadbeef', index: 0 })],
      },
      step(tool('finish_run')),
    ]);
    orch = orchestrator(chain, llm as never);
    const result = await orch.run();
    expect(chain.stats.submissions).toBe(0);
    expect(result.audit.some((entry) => entry.kind === 'action.rejected')).toBe(true);
  });

  test('a mandate that does not match the active mandate on chain fails closed', async () => {
    // A load-balanced RPC can answer the mandate read from a different block
    // than the vault read. Planning against that budget would be wrong, so the
    // run must stop instead of acting.
    const inner = new MockChainPort(chainConfig());
    const chain = new MismatchedMandateChain(inner);
    let orch!: RescueOrchestrator;
    const llm = new ScriptedLlm([...runTrace(), executeAll(orch), step(tool('finish_run'))]);
    orch = orchestrator(chain, llm as never);
    const result = await orch.run();

    expect(inner.stats.submissions).toBe(0);
    expect(result.state).toBe('HALTED_NEEDS_OWNER');
    expect(result.report.haltReason?.kind).toBe('STALE_OR_CONFLICTING_DATA');
  });

  test('a stale post-action read is retried, never recorded as a $0 spend', async () => {
    // A load-balanced RPC can answer the first read after a mined action with
    // the pre-action state. The agent must re-read instead of recording a $0
    // spend (and instead of judging check #16 against a stale health factor).
    const inner = new MockChainPort(chainConfig());
    const chain = new LaggingReadChain(inner);
    let orch!: RescueOrchestrator;
    const llm = new ScriptedLlm([...runTrace(), executeAll(orch), step(tool('finish_run'))]);
    orch = orchestrator(chain, llm as never);
    const result = await orch.run();
    const finalVault = await chain.getVault();

    expect(result.ledger).toHaveLength(2);
    expect(result.ledger.every((entry) => entry.status === 'mined' && entry.spendUsd8 > 0n)).toBe(true);
    expect(result.ledger.reduce((sum, entry) => sum + entry.spendUsd8, 0n)).toBe(finalVault.spentUsd8);
    expect(result.report.spentUsd8).toBe(finalVault.spentUsd8);
    expect(result.state).not.toBe('HALTED_NEEDS_OWNER');
  });

  test('MAX_PLAN_AGE_BLOCKS forces a replan and never submits the stale action', async () => {    const chain = new MockChainPort(chainConfig());
    let orch!: RescueOrchestrator;
    const llm = new ScriptedLlm([
      ...runTrace(),
      {
        toolCalls: () => {
          chain.advance(3n, 36n);
          const plan = orch.currentPlan;
          if (!plan) throw new Error('missing plan');
          return [tool('execute_plan_action', { planId: plan.planId, index: 0 })];
        },
      },
      step(tool('finish_run')),
    ]);
    orch = orchestrator(chain, llm as never);
    const result = await orch.run();
    expect(chain.stats.submissions).toBe(0);
    expect(result.audit.some((entry) => entry.kind === 'action.rejected')).toBe(true);
  });

  test('unknown submit is reconciled via getTx and never resubmitted', async () => {
    const chain = new MockChainPort(chainConfig({ unknownSubmitOnce: true }));
    let orch!: RescueOrchestrator;
    const llm = new ScriptedLlm([...runTrace(), executeAll(orch), step(tool('finish_run'))]);
    orch = orchestrator(chain, llm as never);
    const result = await orch.run();

    expect(result.ledger.every((entry) => entry.status === 'mined')).toBe(true);
    expect(result.ledger.reduce((sum, entry) => sum + entry.spendUsd8, 0n)).toBe(
      (await chain.getVault()).spentUsd8,
    );
    expect(chain.stats.submissions).toBe(chain.getActionEvents().length);
    expect(result.audit.some((entry) => entry.kind === 'action.mined' && (entry.data as { reconciled?: boolean }).reconciled === true)).toBe(true);
  });

  test('MAX_TOOL_CALLS aborts the run', async () => {
    const chain = new MockChainPort(chainConfig());
    const traces = Array.from({ length: 31 }, () => step(tool('get_state')));
    const orch = orchestrator(chain, new ScriptedLlm(traces) as never);
    const result = await orch.run();
    expect(result.state).toBe('ABORTED');
    expect(result.toolCalls).toBe(30);
    expect(result.audit.some((entry) => entry.kind === 'abort')).toBe(true);
  });
});
