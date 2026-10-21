import { LENDING_SIM_ABI, MANDATE_VAULT_ABI, type Action, type Hex } from '@marginpilot/core';
import { encodeErrorResult, zeroAddress } from 'viem';
import { describe, expect, test } from 'vitest';

import { decodeChainError, fromContractMandate, toContractAction } from '../src/chain/viem-port.js';

const TOKEN_IN = '0x00000000000000000000000000000000000000a2' as const;
const TOKEN_OUT = '0x00000000000000000000000000000000000000a3' as const;
const TARGET = '0x00000000000000000000000000000000000000b1' as const;

function action(overrides: Partial<Action> = {}): Action {
  return {
    mandateId: 7n,
    nonce: 3n,
    actionType: 'REPAY',
    target: TARGET,
    poolId: 0,
    tokenIn: TOKEN_IN,
    tokenOut: null,
    amount: 1_000n,
    minAmountOut: 0n,
    quotedPriceUsd8: 200_000_000_000n,
    deadline: 1_800_000_000n,
    ...overrides,
  };
}

describe('ViemChainPort mappings', () => {
  test('maps every ActionType to the Solidity enum and null tokenOut to address(0)', () => {
    expect(toContractAction(action({ actionType: 'REPAY' })).actionType).toBe(0);
    expect(toContractAction(action({ actionType: 'SUPPLY_COLLATERAL' })).actionType).toBe(1);
    expect(toContractAction(action({ actionType: 'SWAP', tokenOut: TOKEN_OUT })).actionType).toBe(2);
    expect(toContractAction(action({ actionType: 'BORROW' })).actionType).toBe(3);
    expect(toContractAction(action()).tokenOut).toBe(zeroAddress);
    expect(toContractAction(action({ tokenOut: TOKEN_OUT })).tokenOut).toBe(TOKEN_OUT);
  });

  test('maps a contract mandate without changing bigint or array order', () => {
    const mandate = fromContractMandate({
      id: 2n,
      validFrom: 10n,
      validUntil: 20n,
      maxTotalSpendUsd: 26_000_000_000n,
      maxPerActionUsd: 26_000_000_000n,
      minLiquidReserveUsd: 10_000_000_000n,
      maxSlippageBps: 100,
      maxPriceAgeSec: 600,
      maxPriceDeviationBps: 300,
      allowedActions: 3,
      allowBorrow: false,
      allowedTargets: [TARGET],
      lockedTokens: [TOKEN_IN],
    });
    expect(mandate.id).toBe(2n);
    expect(mandate.maxTotalSpendUsd).toBe(26_000_000_000n);
    expect(mandate.allowedTargets).toEqual([TARGET]);
    expect(mandate.lockedTokens).toEqual([TOKEN_IN]);
  });
});

describe('decodeChainError', () => {
  test('maps vault custom errors to the frozen names', () => {
    const data = encodeErrorResult({ abi: MANDATE_VAULT_ABI, errorName: 'BudgetExceeded' });
    expect(decodeChainError({ data })).toEqual({ error: 'BudgetExceeded' });
  });

  test('reads nested viem-style causes', () => {
    expect(decodeChainError({ cause: { data: { errorName: 'Paused' } } })).toEqual({ error: 'Paused' });
  });

  test('maps target-specific simulator errors to Unknown with a raw name', () => {
    const data = encodeErrorResult({ abi: LENDING_SIM_ABI, errorName: 'PoolPaused', args: [0] });
    const decoded = decodeChainError({ data });
    expect(decoded.error).toBe('Unknown');
    expect(decoded.raw).toBe('PoolPaused');
  });

  test('never invents a policy error for an opaque revert', () => {
    const decoded = decodeChainError(new Error('execution reverted'));
    expect(decoded.error).toBe('Unknown');
    expect(decoded.raw).toContain('execution reverted');
  });

  test('accepts a raw hex payload nested in cause.data.data', () => {
    const data = encodeErrorResult({ abi: MANDATE_VAULT_ABI, errorName: 'StalePrice' }) as Hex;
    expect(decodeChainError({ cause: { data: { data } } })).toEqual({ error: 'StalePrice' });
  });
});
