import { describe, expect, test } from 'vitest';

import {
  MockChainPort,
  type Action,
  type Address,
  type ChainPort,
  type SubmitResult,
  type TxStatus,
} from '@marginpilot/core';

import { RunSession } from '../src/api/events.js';
import { demoChainConfig } from '../src/demo/fixtures.js';
import { LOCAL_TEST_REGISTRY } from '../src/mandate/registry.js';

/**
 * Public testnets mine a block every ~12 seconds, so a confirmed action ages the
 * plan by several blocks. The chain below mimics that: every mined submit moves
 * the chain forward by four blocks.
 */
class SlowChain implements ChainPort {
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
    this.inner.advance(3n, 36n);
    return result;
  }
}

describe('run session on a slow (public testnet) chain', () => {
  test('a plan that ages out is replanned and the rescue still completes', async () => {
    const inner = new MockChainPort(demoChainConfig());
    const chain = new SlowChain(inner);
    const session = new RunSession({
      runId: 'run-slow-chain',
      chain,
      registry: LOCAL_TEST_REGISTRY,
      autoExecute: true,
    });

    const result = await session.start();
    const mined = result.ledger.filter((entry) => entry.status === 'mined');

    expect(mined).toHaveLength(2);
    expect(result.replans).toBeGreaterThanOrEqual(1);
    // The stale action was never broadcast: only the two replanned actions were.
    expect(inner.stats.submissions).toBe(2);
    expect(result.audit.some((entry) => entry.kind === 'replan')).toBe(true);
    expect(result.audit.some((entry) => entry.kind === 'action.rejected')).toBe(true);
    expect(result.state).not.toBe('HALTED_NEEDS_OWNER');
    expect(result.state).not.toBe('ABORTED');
  });
});
