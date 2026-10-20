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

export interface ChainPort {
  getVault(): Promise<VaultSnapshot>;
  getPositions(): Promise<PositionSnapshot[]>;
  getPrices(tokens: Address[]): Promise<PriceSnapshot[]>;
  getMandate(): Promise<Mandate | null>;
  simulate(
    action: Action,
  ): Promise<{ ok: true; valueUsd8: bigint } | { ok: false; error: ErrorName | 'Unknown'; raw?: string }>;
  submit(action: Action): Promise<SubmitResult>;
  getTx(hash: Hex): Promise<TxStatus>;
  pause(): Promise<Hex>;
  demoSetPrice(token: Address, priceUsd8: bigint, updatedAt?: bigint): Promise<Hex>;
  demoSetPoolPaused(pool: number, paused: boolean): Promise<Hex>;
}
