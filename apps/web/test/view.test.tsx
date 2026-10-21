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

  test('chain mode links the deployment and every transaction to the explorer', () => {
    const html = renderToStaticMarkup(<App initialState={{
      ...state(false),
      simulated: false,
      mode: 'TESTNET',
      chainId: 11155111,
      explorerBase: 'https://sepolia.etherscan.io',
      vaultAddress: '0x2014c1F2f3175f46f9b2158fe68510Dc3F05fFA1',
      mandateTxHash: '0xa01bc76d034806cb9f93b924278ee49d2509f3ad21b8ea64e2a61548b0222e1d',
      contracts: {
        vault: '0x2014c1F2f3175f46f9b2158fe68510Dc3F05fFA1',
        oracle: '0x7A0716f915E6e9560E8bD05d05A63d192D1c3FB1',
        lending: '0xa73052A152Fd764Fb399f1F857E95289568eafCE',
        swap: '0xc7b7F3E6F25E43e7d7cf225af5D2145D5c307bcB',
      },
      tokens: [{ symbol: 'mUSDC', address: '0xC4F2Eaf3b0E1EF5F8B67270f896E9ad6Ce42A0E0', decimals: 6 }],
      ledger: [{
        runId: 'run-1', actionIndex: 0, mandateId: 1n, spendUsd8: 8_657_000_000n,
        gasWei: 0n, gasUsd8: null, status: 'mined',
        txHash: '0x72abb3c8c2aa09cd3a01fcc5b83354c8d6e5576450d1d4881ca3d7fa5de640c2',
        ts: 1_792_573_026,
      }],
    } as ApiState} />);

    expect(html).toContain('https://sepolia.etherscan.io/address/0x2014c1F2f3175f46f9b2158fe68510Dc3F05fFA1');
    expect(html).toContain('https://sepolia.etherscan.io/address/0xa73052A152Fd764Fb399f1F857E95289568eafCE');
    expect(html).toContain('https://sepolia.etherscan.io/tx/0x72abb3c8c2aa09cd3a01fcc5b83354c8d6e5576450d1d4881ca3d7fa5de640c2');
    expect(html).toContain('https://sepolia.etherscan.io/tx/0xa01bc76d034806cb9f93b924278ee49d2509f3ad21b8ea64e2a61548b0222e1d');
    expect(html).toContain('TESTNET');
  });

  test('demo mode reveals collapsed scenario lab and a halted owner-decision warning', () => {
    const html = renderToStaticMarkup(<App initialState={{ ...state(true), runState: 'HALTED_NEEDS_OWNER' }} initialHalt="Stale oracle; ask the owner to refresh the price." />);
    expect(html).toContain('Scenario lab');
    expect(html).toContain('Stale oracle; ask the owner to refresh the price.');
    expect(html).toContain('HALTED_NEEDS_OWNER');
  });
});
