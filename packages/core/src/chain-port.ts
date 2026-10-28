import type {
  Action,
  Address,
  ErrorName,
  Hex,
  Mandate,
  PositionSnapshot,
  PriceSnapshot,
  VaultSnapshot,
} from './types.js';

export type TxStatus =
  | { status: 'not_found' }
  | { status: 'pending' }
  | {
      status: 'mined';
      success: boolean;
      blockNumber: bigint;
      gasUsed: bigint;
      effectiveGasPrice: bigint;
      error?: ErrorName | 'Unknown';
    };

export type SubmitResult =
  | { status: 'mined'; txHash: Hex; blockNumber: bigint; gasUsed: bigint; effectiveGasPrice: bigint }
  | { status: 'reverted'; txHash: Hex; error: ErrorName | 'Unknown'; gasUsed: bigint; effectiveGasPrice: bigint }
  | { status: 'unknown'; txHash: Hex };

/** Owner write path. A chain that cannot install a signed mandate does not implement this. */
export interface MandateWriter {
  setMandateWithSig(mandate: Mandate, deadline: bigint, signature: Hex): Promise<SubmitResult>;
}

export interface ChainPort extends Partial<MandateWriter> {
  getVault(): Promise<VaultSnapshot>;
  getPositions(): Promise<PositionSnapshot[]>;
  getPrices(tokens: Address[]): Promise<PriceSnapshot[]>;
  getMandate(): Promise<Mandate | null>;
  /** Next mandate id the vault will accept. Optional so old test doubles stay valid. */
  getNextMandateId?(): Promise<bigint>;
  simulate(
    action: Action,
  ): Promise<{ ok: true; valueUsd8: bigint } | { ok: false; error: ErrorName | 'Unknown'; raw?: string }>;
  submit(action: Action): Promise<SubmitResult>;
  getTx(hash: Hex): Promise<TxStatus>;
  pause(): Promise<Hex>;
  demoSetPrice(token: Address, priceUsd8: bigint, updatedAt?: bigint): Promise<Hex>;
  demoSetPoolPaused(pool: number, paused: boolean): Promise<Hex>;
  demoSetSwapBroken?(broken: boolean): Promise<Hex>;
  /** Restore the demo market to its deployment baseline (unpause, reseed, fresh prices, reserve top-up). */
  demoResetMarket?(baseline: MarketBaseline): Promise<Hex[]>;
  /** Native balance of the executor hot key, for the public-demo gas guard. */
  executorBalance?(): Promise<bigint>;
}

export interface MarketBaseline {
  prices: { token: Address; priceUsd8: bigint }[];
  positions: { poolId: number; collateral: bigint; debt: bigint }[];
  /** The vault is topped up to this reserve token balance if it is below it. */
  reserve: { token: Address; amount: bigint };
}
