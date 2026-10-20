import { keccak256, stringToHex } from 'viem';

import type { ChainPort, SubmitResult, TxStatus } from './chain-port.js';
import { healthFactorWad } from './health.js';
import { checkAction, checkPostConditions, PolicyConfigError } from './policy.js';
import { canonicalJson } from './schemas.js';
import type {
  Action,
  Address,
  ErrorName,
  Hex,
  Mandate,
  PolicyContext,
  PositionSnapshot,
  PriceSnapshot,
  VaultSnapshot,
} from './types.js';
import { mulDivFloor } from './valuation.js';

const SWAP_FEE_BPS = 30n;

export interface MockActionEvent {
  txHash: Hex;
  mandateId: bigint;
  nonce: bigint;
  actionType: Action['actionType'];
  target: Address;
  tokenIn: Address;
  amount: bigint;
  valueUsd8: bigint;
  spentUsd8After: bigint;
  blockNumber: bigint;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
}

export interface MockChainConfig {
  owner: Address;
  executor: Address;
  mandate: Mandate | null;
  positions: PositionSnapshot[];
  prices: PriceSnapshot[];
  vault: VaultSnapshot;
  tokenDecimals: Record<Address, number>;
  reserveToken: Address;
  lendingSim: Address;
  swapTarget?: Address;
  poolPaused?: Record<number, boolean>;
  swapBroken?: boolean;
  demoEnabled?: boolean;
  unknownSubmitOnce?: boolean;
  chainId?: number;
  gasUsed?: bigint;
  effectiveGasPrice?: bigint;
}

type Simulation = { ok: true; valueUsd8: bigint } | { ok: false; error: ErrorName | 'Unknown'; raw?: string };

interface Preview {
  positions: PositionSnapshot[];
  vault: VaultSnapshot;
  event: Omit<MockActionEvent, 'txHash'>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function addressKey<T>(record: Record<string, T>, address: Address): string | undefined {
  return Object.keys(record).find((key) => key.toLowerCase() === address.toLowerCase());
}

/**
 * In-memory chain with the same policy checks, health-factor math and atomic effects as
 * LendingSim + MandateVault. It is the differential oracle for FR-16, not real chain state.
 */
export class MockChainPort implements ChainPort {
  private readonly owner: Address;
  private readonly executor: Address;
  private mandate: Mandate | null;
  private positions: PositionSnapshot[];
  private prices: PriceSnapshot[];
  private vault: VaultSnapshot;
  private readonly tokenDecimals: Record<Address, number>;
  private readonly reserveToken: Address;
  private readonly lendingSim: Address;
  private readonly swapTarget: Address | undefined;
  private readonly demoEnabled: boolean;
  private readonly gasUsed: bigint;
  private readonly effectiveGasPrice: bigint;
  private readonly chainId: number;
  private readonly poolPaused: Record<number, boolean>;
  private swapBroken: boolean;
  private unknownSubmitOnce: boolean;
  private readonly transactions = new Map<Hex, TxStatus>();
  private readonly seen = new Map<Hex, SubmitResult>();
  private readonly events: MockActionEvent[] = [];
  private txCounter = 0n;
  readonly stats = { simulations: 0, submissions: 0 };

  constructor(config: MockChainConfig) {
    this.owner = config.owner;
    this.executor = config.executor;
    this.mandate = clone(config.mandate);
    this.positions = clone(config.positions);
    this.prices = clone(config.prices);
    this.vault = clone(config.vault);
    this.tokenDecimals = clone(config.tokenDecimals);
    this.reserveToken = config.reserveToken;
    this.lendingSim = config.lendingSim;
    this.swapTarget = config.swapTarget;
    this.poolPaused = clone(config.poolPaused ?? {});
    this.swapBroken = config.swapBroken ?? false;
    this.demoEnabled = config.demoEnabled ?? false;
    this.unknownSubmitOnce = config.unknownSubmitOnce ?? false;
    this.chainId = config.chainId ?? 31337;
    this.gasUsed = config.gasUsed ?? 120_000n;
    this.effectiveGasPrice = config.effectiveGasPrice ?? 1_000_000_000n;
  }

  async getVault(): Promise<VaultSnapshot> {
    return clone(this.vault);
  }

  async getPositions(): Promise<PositionSnapshot[]> {
    return clone(this.positions);
  }

  async getPrices(tokens: Address[]): Promise<PriceSnapshot[]> {
    return clone(
      tokens.map((token) => {
        const price = this.priceOf(token);
        if (price === undefined) throw new Error(`unknown token ${token}`);
        return price;
      }),
    );
  }

  async getMandate(): Promise<Mandate | null> {
    return this.vault.activeMandateId === 0n || this.mandate === null ? null : clone(this.mandate);
  }

  async simulate(action: Action): Promise<Simulation> {
    return this.evaluate(action).result;
  }

  async submit(action: Action): Promise<SubmitResult> {
    const fingerprint = keccak256(stringToHex(canonicalJson(action)));
    const existing = this.seen.get(fingerprint);
    if (existing !== undefined) return clone(existing);

    this.stats.submissions += 1;
    const evaluation = this.evaluate(action);
    const txHash = this.nextTxHash(fingerprint);
    if (!evaluation.result.ok || evaluation.preview === undefined) {
      const error: ErrorName | 'Unknown' = evaluation.result.ok ? 'Unknown' : evaluation.result.error;
      const result: SubmitResult = {
        status: 'reverted',
        txHash,
        error,
        gasUsed: this.gasUsed,
        effectiveGasPrice: this.effectiveGasPrice,
      };
      this.transactions.set(txHash, {
        status: 'mined',
        success: false,
        blockNumber: this.vault.blockNumber,
        gasUsed: this.gasUsed,
        effectiveGasPrice: this.effectiveGasPrice,
        error,
      });
      this.seen.set(fingerprint, result);
      return clone(result);
    }

    const preview = evaluation.preview;
    this.positions = preview.positions;
    this.vault = preview.vault;
    const event: MockActionEvent = { ...preview.event, txHash };
    this.events.push(event);
    this.transactions.set(txHash, {
      status: 'mined',
      success: true,
      blockNumber: preview.vault.blockNumber,
      gasUsed: this.gasUsed,
      effectiveGasPrice: this.effectiveGasPrice,
    });
    let result: SubmitResult;
    if (this.unknownSubmitOnce) {
      this.unknownSubmitOnce = false;
      result = { status: 'unknown', txHash };
    } else {
      result = {
        status: 'mined',
        txHash,
        blockNumber: preview.vault.blockNumber,
        gasUsed: this.gasUsed,
        effectiveGasPrice: this.effectiveGasPrice,
      };
    }
    this.seen.set(fingerprint, result);
    return clone(result);
  }

  async getTx(hash: Hex): Promise<TxStatus> {
    const status = this.transactions.get(hash);
    return status === undefined ? { status: 'not_found' } : clone(status);
  }

  async pause(): Promise<Hex> {
    const txHash = this.nextTxHash(keccak256(stringToHex(`pause:${this.vault.blockNumber}`)));
    this.vault.paused = true;
    this.advance(1n, 12n);
    this.transactions.set(txHash, {
      status: 'mined',
      success: true,
      blockNumber: this.vault.blockNumber,
      gasUsed: this.gasUsed,
      effectiveGasPrice: this.effectiveGasPrice,
    });
    return txHash;
  }

  async demoSetPrice(token: Address, priceUsd8: bigint, updatedAt?: bigint): Promise<Hex> {
    this.requireDemo();
    if (priceUsd8 <= 0n) throw new RangeError('price must be positive');
    this.advance(1n, 12n);
    const index = this.prices.findIndex((price) => sameAddress(price.token, token));
    const next: PriceSnapshot = {
      token,
      priceUsd8,
      updatedAt: updatedAt ?? this.vault.blockTimestamp,
    };
    if (index >= 0) this.prices[index] = next;
    else this.prices.push(next);
    this.vault.liquidReserveUsd8 = this.liquidReserveUsd8(this.vault);
    this.positions = this.positions.map((position) => ({
      ...position,
      healthFactor: this.health(position),
    }));
    const txHash = this.nextTxHash(keccak256(stringToHex(`price:${token}:${priceUsd8}`)));
    this.transactions.set(txHash, {
      status: 'mined',
      success: true,
      blockNumber: this.vault.blockNumber,
      gasUsed: this.gasUsed,
      effectiveGasPrice: this.effectiveGasPrice,
    });
    return txHash;
  }

  async demoSetPoolPaused(pool: number, paused: boolean): Promise<Hex> {
    this.requireDemo();
    this.poolPaused[pool] = paused;
    this.advance(1n, 12n);
    const txHash = this.nextTxHash(keccak256(stringToHex(`pool:${pool}:${paused}`)));
    this.transactions.set(txHash, {
      status: 'mined',
      success: true,
      blockNumber: this.vault.blockNumber,
      gasUsed: this.gasUsed,
      effectiveGasPrice: this.effectiveGasPrice,
    });
    return txHash;
  }

  async demoSetSwapBroken(broken: boolean): Promise<Hex> {
    this.requireDemo();
    this.swapBroken = broken;
    this.advance(1n, 12n);
    return this.nextTxHash(keccak256(stringToHex(`swap:${broken}`)));
  }

  /**
   * SIMULATED owner confirmation: installs a mandate in the in-memory chain.
   * The real vault path is `setMandateWithSig` in `ViemChainPort`/B-08.
   */
  async demoSetMandate(mandate: Mandate): Promise<Hex> {
    this.requireDemo();
    if (mandate.id <= this.vault.activeMandateId) {
      throw new Error('demo mandate id must be greater than the active mandate id');
    }
    this.mandate = clone(mandate);
    this.vault.activeMandateId = mandate.id;
    this.advance(1n, 12n);
    const txHash = this.nextTxHash(keccak256(stringToHex(`mandate:${mandate.id}`)));
    this.transactions.set(txHash, {
      status: 'mined',
      success: true,
      blockNumber: this.vault.blockNumber,
      gasUsed: this.gasUsed,
      effectiveGasPrice: this.effectiveGasPrice,
    });
    return txHash;
  }

  advance(blocks: bigint, seconds: bigint): void {
    this.vault.blockNumber += blocks;
    this.vault.blockTimestamp += seconds;
  }

  getActionEvents(): MockActionEvent[] {
    return clone(this.events);
  }

  getOwner(): Address {
    return this.owner;
  }

  private requireDemo(): void {
    if (!this.demoEnabled) throw new Error('demo-only method disabled (DEMO_MODE=false)');
  }

  private context(): PolicyContext {
    const pools: PolicyContext['pools'] = {};
    for (const position of this.positions) {
      pools[position.poolId] = {
        collateralToken: position.collateralToken,
        debtToken: position.debtToken,
      };
    }
    return {
      caller: this.executor,
      executor: this.executor,
      tokenDecimals: this.tokenDecimals,
      pools,
    };
  }

  private priceOf(token: Address): PriceSnapshot | undefined {
    return this.prices.find((price) => sameAddress(price.token, token));
  }

  private decimalsOf(token: Address): number {
    const key = addressKey(this.tokenDecimals, token);
    const decimals =
      key === undefined ? undefined : (this.tokenDecimals as Record<string, number>)[key];
    if (decimals === undefined) throw new PolicyConfigError(`missing token decimals for ${token}`);
    return decimals;
  }

  private balanceOf(vault: VaultSnapshot, token: Address): bigint {
    const key = addressKey(vault.balances, token);
    return key === undefined ? 0n : ((vault.balances as Record<string, bigint>)[key] ?? 0n);
  }

  private setBalance(vault: VaultSnapshot, token: Address, amount: bigint): void {
    const key = addressKey(vault.balances, token);
    if (key === undefined) vault.balances[token] = amount;
    else (vault.balances as Record<string, bigint>)[key] = amount;
  }

  private liquidReserveUsd8(vault: VaultSnapshot): bigint {
    const price = this.priceOf(this.reserveToken);
    if (price === undefined) return 0n;
    return mulDivFloor(
      this.balanceOf(vault, this.reserveToken),
      price.priceUsd8,
      10n ** BigInt(this.decimalsOf(this.reserveToken)),
    );
  }

  private health(position: PositionSnapshot, prices: PriceSnapshot[] = this.prices): bigint {
    const collateralPrice = prices.find((price) => sameAddress(price.token, position.collateralToken));
    const debtPrice = prices.find((price) => sameAddress(price.token, position.debtToken));
    if (collateralPrice === undefined || debtPrice === undefined) return 0n;
    return healthFactorWad({
      collateral: position.collateral,
      collateralDecimals: this.decimalsOf(position.collateralToken),
      collateralPriceUsd8: collateralPrice.priceUsd8,
      ltBps: position.ltBps,
      debt: position.debt,
      debtDecimals: this.decimalsOf(position.debtToken),
      debtPriceUsd8: debtPrice.priceUsd8,
    });
  }

  private nextTxHash(fingerprint: Hex): Hex {
    this.txCounter += 1n;
    return keccak256(
      stringToHex(`${this.chainId}:${this.vault.blockNumber}:${this.vault.actionNonce}:${this.txCounter}:${fingerprint}`),
    );
  }

  private evaluate(action: Action): { result: Simulation; preview?: Preview } {
    this.stats.simulations += 1;
    let verdict;
    try {
      verdict = checkAction(this.mandate, this.vault, this.prices, action, this.vault.blockTimestamp, this.context());
    } catch (error) {
      return {
        result: {
          ok: false,
          error: 'Unknown',
          raw: error instanceof Error ? error.message : 'policy configuration error',
        },
      };
    }
    if (!verdict.ok) return { result: verdict };

    const positions = clone(this.positions);
    const vault = clone(this.vault);
    const index = positions.findIndex((position) => position.poolId === action.poolId);
    const position = positions[index];
    const lending = action.actionType !== 'SWAP';
    if (lending && (position === undefined || !sameAddress(action.target, this.lendingSim))) {
      return { result: { ok: false, error: 'Unknown', raw: 'UnknownLendingTargetOrPool' } };
    }
    if (lending && this.poolPaused[action.poolId] === true) {
      return { result: { ok: false, error: 'Unknown', raw: 'PoolPaused' } };
    }
    if (position === undefined) return { result: { ok: false, error: 'Unknown', raw: 'UnknownPool' } };

    let beforeHealth = this.health(position);
    if (action.actionType === 'REPAY') {
      if (!sameAddress(action.tokenIn, position.debtToken)) {
        return { result: { ok: false, error: 'Unknown', raw: 'RepayTokenIsNotDebtToken' } };
      }
      const balance = this.balanceOf(vault, action.tokenIn);
      if (balance < action.amount) return { result: { ok: false, error: 'Unknown', raw: 'InsufficientBalance' } };
      this.setBalance(vault, action.tokenIn, balance - action.amount);
      position.debt = position.debt > action.amount ? position.debt - action.amount : 0n;
    } else if (action.actionType === 'SUPPLY_COLLATERAL') {
      if (!sameAddress(action.tokenIn, position.collateralToken)) {
        return { result: { ok: false, error: 'Unknown', raw: 'SupplyTokenIsNotCollateralToken' } };
      }
      const balance = this.balanceOf(vault, action.tokenIn);
      if (balance < action.amount) return { result: { ok: false, error: 'Unknown', raw: 'InsufficientBalance' } };
      this.setBalance(vault, action.tokenIn, balance - action.amount);
      position.collateral += action.amount;
    } else if (action.actionType === 'BORROW') {
      if (!sameAddress(action.tokenIn, position.debtToken)) {
        return { result: { ok: false, error: 'Unknown', raw: 'BorrowTokenIsNotDebtToken' } };
      }
      position.debt += action.amount;
      if (this.health(position) < 10n ** 18n) {
        return { result: { ok: false, error: 'Unknown', raw: 'UndercollateralizedBorrow' } };
      }
      this.setBalance(vault, action.tokenIn, this.balanceOf(vault, action.tokenIn) + action.amount);
    } else {
      if (this.swapBroken) return { result: { ok: false, error: 'Unknown', raw: 'SwapBroken' } };
      if (action.tokenOut === null) return { result: { ok: false, error: 'Unknown', raw: 'MissingTokenOut' } };
      if (this.swapTarget !== undefined && !sameAddress(action.target, this.swapTarget)) {
        return { result: { ok: false, error: 'Unknown', raw: 'UnknownSwapTarget' } };
      }
      const inBalance = this.balanceOf(vault, action.tokenIn);
      if (inBalance < action.amount) return { result: { ok: false, error: 'Unknown', raw: 'InsufficientBalance' } };
      const inPrice = this.priceOf(action.tokenIn);
      const outPrice = this.priceOf(action.tokenOut);
      if (inPrice === undefined || outPrice === undefined) {
        return { result: { ok: false, error: 'Unknown', raw: 'UnknownPrice' } };
      }
      const amountInUsd8 = mulDivFloor(
        action.amount,
        inPrice.priceUsd8,
        10n ** BigInt(this.decimalsOf(action.tokenIn)),
      );
      const outUsd8 = mulDivFloor(amountInUsd8, 10_000n - SWAP_FEE_BPS, 10_000n);
      const amountOut = mulDivFloor(
        outUsd8,
        10n ** BigInt(this.decimalsOf(action.tokenOut)),
        outPrice.priceUsd8,
      );
      if (amountOut < action.minAmountOut) {
        return { result: { ok: false, error: 'SlippageExceeded' } };
      }
      this.setBalance(vault, action.tokenIn, inBalance - action.amount);
      this.setBalance(vault, action.tokenOut, this.balanceOf(vault, action.tokenOut) + amountOut);
      beforeHealth = 0n;
    }

    const afterHealth = lending ? this.health(position) : 0n;
    const afterLiquidReserve = this.liquidReserveUsd8(vault);
    const post = checkPostConditions(
      { action, mandate: this.mandate as Mandate },
      { liquidReserveUsd8: this.vault.liquidReserveUsd8, healthFactor: beforeHealth },
      { liquidReserveUsd8: afterLiquidReserve, healthFactor: afterHealth },
    );
    if (!post.ok) return { result: post };

    if (lending && position !== undefined) position.healthFactor = afterHealth;

    vault.actionNonce += 1n;
    vault.spentUsd8 += verdict.valueUsd8;
    vault.blockNumber += 1n;
    vault.blockTimestamp += 12n;
    vault.liquidReserveUsd8 = afterLiquidReserve;
    return {
      result: { ok: true, valueUsd8: verdict.valueUsd8 },
      preview: {
        positions,
        vault,
        event: {
          mandateId: action.mandateId,
          nonce: action.nonce,
          actionType: action.actionType,
          target: action.target,
          tokenIn: action.tokenIn,
          amount: action.amount,
          valueUsd8: verdict.valueUsd8,
          spentUsd8After: vault.spentUsd8,
          blockNumber: vault.blockNumber,
          gasUsed: this.gasUsed,
          effectiveGasPrice: this.effectiveGasPrice,
        },
      },
    };
  }
}
