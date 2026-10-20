import type { SubmitResult, TxStatus } from './chain-port.js';
import type { LedgerEntry } from './types.js';

export interface LedgerEntryInput {
  runId: string;
  actionIndex: number;
  mandateId: bigint;
  result: SubmitResult;
  /** Required for mined results; comes from the ActionExecuted event, never a simulated estimate. */
  spendUsd8?: bigint;
  gasUsd8?: bigint | null;
  ts: number;
}

export function ledgerEntryFromResult(input: LedgerEntryInput): LedgerEntry {
  const { result } = input;
  if (result.status === 'mined') {
    if (input.spendUsd8 === undefined) {
      throw new Error('mined ledger entries require spendUsd8 from ActionExecuted');
    }
    return {
      runId: input.runId,
      actionIndex: input.actionIndex,
      txHash: result.txHash,
      mandateId: input.mandateId,
      spendUsd8: input.spendUsd8,
      gasWei: result.gasUsed * result.effectiveGasPrice,
      gasUsd8: input.gasUsd8 ?? null,
      status: 'mined',
      ts: input.ts,
    };
  }
  if (result.status === 'reverted') {
    return {
      runId: input.runId,
      actionIndex: input.actionIndex,
      txHash: result.txHash,
      mandateId: input.mandateId,
      spendUsd8: 0n,
      gasWei: result.gasUsed * result.effectiveGasPrice,
      gasUsd8: input.gasUsd8 ?? null,
      status: 'reverted',
      ...(result.error === 'Unknown' ? {} : { error: result.error }),
      ts: input.ts,
    };
  }
  return {
    runId: input.runId,
    actionIndex: input.actionIndex,
    txHash: result.txHash,
    mandateId: input.mandateId,
    spendUsd8: 0n,
    gasWei: 0n,
    gasUsd8: input.gasUsd8 ?? null,
    status: 'unknown',
    ts: input.ts,
  };
}

export function ledgerSpendUsd8(entries: readonly LedgerEntry[]): bigint {
  return entries.reduce((sum, entry) => sum + entry.spendUsd8, 0n);
}

/** Reconcile an UNKNOWN submit without ever resending it. Not-found/pending stay UNKNOWN. */
export function reconcileLedgerEntry(
  entry: LedgerEntry,
  tx: TxStatus,
  spendUsd8?: bigint,
): LedgerEntry {
  if (entry.status !== 'unknown') throw new Error('only unknown ledger entries can be reconciled');
  if (tx.status !== 'mined') return entry;
  if (tx.success) {
    if (spendUsd8 === undefined) throw new Error('mined reconciliation requires spendUsd8 from ActionExecuted');
    return {
      ...entry,
      status: 'mined',
      spendUsd8,
      gasWei: tx.gasUsed * tx.effectiveGasPrice,
    };
  }
  return {
    ...entry,
    status: 'reverted',
    spendUsd8: 0n,
    gasWei: tx.gasUsed * tx.effectiveGasPrice,
    ...(tx.error === undefined || tx.error === 'Unknown' ? {} : { error: tx.error }),
  };
}
