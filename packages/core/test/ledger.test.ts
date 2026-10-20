import { describe, expect, test } from 'vitest';

import {
  MockChainPort,
  ledgerEntryFromResult,
  ledgerSpendUsd8,
  reconcileLedgerEntry,
  type Action,
  type SubmitResult,
  type TxStatus,
} from '../src/index.js';
import {
  FIXTURE_NOW,
  TEST_ADDRESSES,
  fixtureMandate,
  fixtureMarket,
  fixturePositions,
  fixturePrices,
  fixtureVault,
} from './fixtures.js';

const executor = '0x00000000000000000000000000000000000000e1' as const;
const owner = '0x00000000000000000000000000000000000000e3' as const;

const action: Action = {
  mandateId: 1n,
  nonce: 7n,
  actionType: 'REPAY',
  target: TEST_ADDRESSES.lending,
  poolId: 0,
  tokenIn: TEST_ADDRESSES.mUSDC,
  tokenOut: null,
  amount: 86_570_000n,
  minAmountOut: 0n,
  quotedPriceUsd8: 100_000_000n,
  deadline: FIXTURE_NOW + 120n,
};

function chain(config: { unknownSubmitOnce?: boolean } = {}): MockChainPort {
  return new MockChainPort({
    owner,
    executor,
    mandate: fixtureMandate,
    positions: fixturePositions,
    prices: fixturePrices,
    vault: fixtureVault,
    tokenDecimals: fixtureMarket.tokenDecimals,
    reserveToken: TEST_ADDRESSES.mUSDC,
    lendingSim: TEST_ADDRESSES.lending,
    ...config,
  });
}

describe('ledger from ActionExecuted facts', () => {
  test('takes spend and gas from the mined event and result', async () => {
    const mock = chain();
    const result = await mock.submit(action);
    if (result.status !== 'mined') throw new Error('expected mined');
    const [event] = mock.getActionEvents();
    if (event === undefined) throw new Error('expected event');
    const entry = ledgerEntryFromResult({
      runId: 'run-1',
      actionIndex: 0,
      mandateId: 1n,
      result,
      spendUsd8: event.valueUsd8,
      gasUsd8: null,
      ts: 1_700_000_100,
    });
    expect(entry).toEqual({
      runId: 'run-1',
      actionIndex: 0,
      txHash: result.txHash,
      mandateId: 1n,
      spendUsd8: 8_657_000_000n,
      gasWei: 120_000n * 1_000_000_000n,
      gasUsd8: null,
      status: 'mined',
      ts: 1_700_000_100,
    });
    expect(ledgerSpendUsd8([entry])).toBe((await mock.getVault()).spentUsd8);
  });

  test('records a reverted action with zero spend and its error', () => {
    const reverted: SubmitResult = {
      status: 'reverted',
      txHash: `0x${'1'.repeat(64)}`,
      error: 'BudgetExceeded',
      gasUsed: 50_000n,
      effectiveGasPrice: 2n,
    };
    const entry = ledgerEntryFromResult({
      runId: 'run-1',
      actionIndex: 1,
      mandateId: 1n,
      result: reverted,
      gasUsd8: 3n,
      ts: 1,
    });
    expect(entry).toMatchObject({
      status: 'reverted',
      spendUsd8: 0n,
      gasWei: 100_000n,
      gasUsd8: 3n,
      error: 'BudgetExceeded',
    });
  });

  test('refuses a mined entry without event-derived spend', () => {
    const mined: SubmitResult = {
      status: 'mined',
      txHash: `0x${'2'.repeat(64)}`,
      blockNumber: 10n,
      gasUsed: 100n,
      effectiveGasPrice: 1n,
    };
    expect(() =>
      ledgerEntryFromResult({ runId: 'run-1', actionIndex: 0, mandateId: 1n, result: mined, ts: 1 }),
    ).toThrow(/ActionExecuted/i);
  });
});

describe('UNKNOWN ledger reconciliation', () => {
  test('keeps UNKNOWN on pending/not_found and only settles from getTx', async () => {
    const mock = chain({ unknownSubmitOnce: true });
    const result = await mock.submit(action);
    if (result.status !== 'unknown') throw new Error('expected unknown');
    const entry = ledgerEntryFromResult({
      runId: 'run-2',
      actionIndex: 0,
      mandateId: 1n,
      result,
      ts: 2,
    });
    expect(entry).toMatchObject({ status: 'unknown', spendUsd8: 0n, gasWei: 0n });

    const pending: TxStatus = { status: 'pending' };
    expect(reconcileLedgerEntry(entry, pending)).toBe(entry);
    expect(reconcileLedgerEntry(entry, { status: 'not_found' })).toBe(entry);

    const [event] = mock.getActionEvents();
    if (event === undefined) throw new Error('expected event');
    const tx = await mock.getTx(result.txHash);
    const reconciled = reconcileLedgerEntry(entry, tx, event.valueUsd8);
    expect(reconciled).toMatchObject({
      status: 'mined',
      spendUsd8: 8_657_000_000n,
      txHash: result.txHash,
    });
    expect(ledgerSpendUsd8([reconciled])).toBe((await mock.getVault()).spentUsd8);
  });

  test('reconciles a mined revert as reverted with zero spend', () => {
    const entry = ledgerEntryFromResult({
      runId: 'run-3',
      actionIndex: 0,
      mandateId: 1n,
      result: { status: 'unknown', txHash: `0x${'3'.repeat(64)}` },
      ts: 3,
    });
    const tx: TxStatus = {
      status: 'mined',
      success: false,
      blockNumber: 5n,
      gasUsed: 21_000n,
      effectiveGasPrice: 2n,
      error: 'PostConditionFailed',
    };
    expect(reconcileLedgerEntry(entry, tx)).toMatchObject({
      status: 'reverted',
      spendUsd8: 0n,
      gasWei: 42_000n,
      error: 'PostConditionFailed',
    });
  });
});
