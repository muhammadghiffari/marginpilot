import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { App } from '../src/app.js';
import type { ApiState } from '../src/api.js';

function state(demoMode: boolean): ApiState {
  return {
    simulated: true, demoMode, runId: null, runState: 'IDLE', ledger: [],
    vault: { blockNumber: 100n, blockTimestamp: 1_700_000_000n, paused: false,
      activeMandateId: 1n, actionNonce: 7n, spentUsd8: 0n,
      liquidReserveUsd8: 40_000_000_000n,
      balances: { '0x00000000000000000000000000000000000000a1': 400_000_000n } },
    mandate: { id: 1n, validFrom: 1_699_999_000n, validUntil: 1_700_086_400n,
      maxTotalSpendUsd: 26_000_000_000n, maxPerActionUsd: 26_000_000_000n,
      minLiquidReserveUsd: 10_000_000_000n, maxSlippageBps: 100,
      maxPriceAgeSec: 600, maxPriceDeviationBps: 300, allowedActions: 3,
      allowBorrow: false,
      allowedTargets: ['0x00000000000000000000000000000000000000b1'],
      lockedTokens: ['0x00000000000000000000000000000000000000a2'] },
    positions: [{ poolId: 0, collateralToken: '0x00000000000000000000000000000000000000a2',
      debtToken: '0x00000000000000000000000000000000000000a1',
      collateral: 1_000_000_000_000_000_000n, debt: 1_400_000_000n,
      healthFactor: 942_857_142_857_142_857n, ltBps: 8_250, liqBonusBps: 500, closeFactorBps: 5_000 }],
    prices: [],
  } as ApiState;
}

describe('mandate rescue UI states', () => {
  test('first use shows the entry action, simulation boundary and no demo lab outside demo mode', () => {
    const html = renderToStaticMarkup(<App initialState={state(false)} />);
    expect(html).toContain('MarginPilot');
    expect(html).toContain('SIMULATED');
    expect(html).toContain('Run rescue');
    expect(html).toContain('0.943');
    expect(html).not.toContain('Scenario lab');
  });

  test('demo mode reveals collapsed scenario lab and a halted owner-decision warning', () => {
    const html = renderToStaticMarkup(<App initialState={{ ...state(true), runState: 'HALTED_NEEDS_OWNER' }} initialHalt="Stale oracle; ask the owner to refresh the price." />);
    expect(html).toContain('Scenario lab');
    expect(html).toContain('Stale oracle; ask the owner to refresh the price.');
    expect(html).toContain('HALTED_NEEDS_OWNER');
  });
});
