import {
  LENDING_SIM_ABI,
  MANDATE_VAULT_ABI,
  MOCK_ERC20_ABI,
  MOCK_ORACLE_ABI,
  MOCK_SWAP_ABI,
  ErrorNameSchema,
  type Action,
  type Address,
  type ChainPort,
  type MarketBaseline,
  type ErrorName,
  type Hex,
  type Mandate,
  type MandateWriter,
  type PositionSnapshot,
  type PriceSnapshot,
  type SubmitResult,
  type TxStatus,
  type VaultSnapshot,
} from '@marginpilot/core';
import {
  BaseError,
  createPublicClient,
  createWalletClient,
  defineChain,
  decodeErrorResult,
  encodeFunctionData,
  http,
  isHex,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  zeroAddress,
  type Abi,
  type Account,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const ACTION_TYPE_INDEX: Record<Action['actionType'], number> = {
  REPAY: 0,
  SUPPLY_COLLATERAL: 1,
  SWAP: 2,
  BORROW: 3,
};

export interface ViemChainPortConfig {
  chainId: number;
  rpcUrl: string;
  vault: Address;
  oracle: Address;
  lending: Address;
  swap: Address;
  owner: Address;
  executor: Address;
  tokens: Address[];
  tokenDecimals: Record<Address, number>;
  reserveToken: Address;
  /** Executor signer. A private key is required off anvil; an address uses an unlocked RPC account. */
  executorSigner: { kind: 'privateKey'; value: Hex } | { kind: 'address'; value: Address };
  /** Owner signer for `setMandateWithSig` and demo admin writes. */
  ownerSigner?: { kind: 'privateKey'; value: Hex } | { kind: 'address'; value: Address };
  receiptTimeoutMs?: number;
  confirmations?: number;
}

export class OwnerSignerNotConfiguredError extends Error {
  constructor() {
    super('an owner signer is not configured for this chain');
    this.name = 'OwnerSignerNotConfiguredError';
  }
}

export class ChainTransactionError extends Error {
  constructor(
    readonly txHash: Hex,
    message: string,
  ) {
    super(message);
    this.name = 'ChainTransactionError';
  }
}

export interface ContractAction {
  mandateId: bigint;
  nonce: bigint;
  actionType: number;
  target: Address;
  poolId: number;
  tokenIn: Address;
  tokenOut: Address;
  amount: bigint;
  minAmountOut: bigint;
  quotedPriceUsd8: bigint;
  deadline: bigint;
}

export function toContractAction(action: Action): ContractAction {
  const actionType = ACTION_TYPE_INDEX[action.actionType];
  if (actionType === undefined) throw new Error(`unknown action type: ${action.actionType}`);
  return {
    mandateId: action.mandateId,
    nonce: action.nonce,
    actionType,
    target: action.target,
    poolId: action.poolId,
    tokenIn: action.tokenIn,
    tokenOut: action.tokenOut ?? zeroAddress,
    amount: action.amount,
    minAmountOut: action.minAmountOut,
    quotedPriceUsd8: action.quotedPriceUsd8,
    deadline: action.deadline,
  };
}

interface ContractMandate {
  id: bigint;
  validFrom: bigint;
  validUntil: bigint;
  maxTotalSpendUsd: bigint;
  maxPerActionUsd: bigint;
  minLiquidReserveUsd: bigint;
  maxSlippageBps: number;
  maxPriceAgeSec: number;
  maxPriceDeviationBps: number;
  allowedActions: number;
  allowBorrow: boolean;
  allowedTargets: readonly Address[];
  lockedTokens: readonly Address[];
}

export function fromContractMandate(value: ContractMandate): Mandate {
  return {
    id: value.id,
    validFrom: value.validFrom,
    validUntil: value.validUntil,
    maxTotalSpendUsd: value.maxTotalSpendUsd,
    maxPerActionUsd: value.maxPerActionUsd,
    minLiquidReserveUsd: value.minLiquidReserveUsd,
    maxSlippageBps: Number(value.maxSlippageBps),
    maxPriceAgeSec: Number(value.maxPriceAgeSec),
    maxPriceDeviationBps: Number(value.maxPriceDeviationBps),
    allowedActions: Number(value.allowedActions),
    allowBorrow: value.allowBorrow,
    allowedTargets: [...value.allowedTargets],
    lockedTokens: [...value.lockedTokens],
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function findRevertName(error: unknown): string | undefined {
  let current: Record<string, unknown> | undefined = asRecord(error);
  for (let depth = 0; depth < 8 && current !== undefined; depth += 1) {
    const data = asRecord(current.data);
    if (typeof data?.errorName === 'string') return data.errorName;
    if (typeof current.errorName === 'string') return current.errorName;
    current = asRecord(current.cause) ?? asRecord(current.error);
  }
  return undefined;
}

function findRevertData(error: unknown): Hex | undefined {
  let current: Record<string, unknown> | undefined = asRecord(error);
  for (let depth = 0; depth < 8 && current !== undefined; depth += 1) {
    if (typeof current.data === 'string' && isHex(current.data)) return current.data;
    const nested = asRecord(current.data);
    if (typeof nested?.data === 'string' && isHex(nested.data)) return nested.data;
    current = asRecord(current.cause) ?? asRecord(current.error);
  }
  return undefined;
}

const ERROR_ABIS: Abi[] = [MANDATE_VAULT_ABI, LENDING_SIM_ABI, MOCK_SWAP_ABI, MOCK_ORACLE_ABI, MOCK_ERC20_ABI];

/**
 * Map a chain revert to the frozen ErrorName set. Target-specific errors
 * (PoolPaused, SwapBroken, InsufficientBalance, ...) are `Unknown` with a raw
 * name so the UI never claims a policy rejection that the vault did not make.
 */
export function decodeChainError(error: unknown): { error: ErrorName | 'Unknown'; raw?: string } {
  const named = findRevertName(error);
  if (named !== undefined) {
    return ErrorNameSchema.safeParse(named).success
      ? { error: named as ErrorName }
      : { error: 'Unknown', raw: named };
  }
  const data = findRevertData(error);
  if (data !== undefined) {
    for (const abi of ERROR_ABIS) {
      try {
        const decoded = decodeErrorResult({ abi, data });
        return ErrorNameSchema.safeParse(decoded.errorName).success
          ? { error: decoded.errorName as ErrorName }
          : { error: 'Unknown', raw: decoded.errorName };
      } catch {
        // Try the next ABI.
      }
    }
  }
  const message = error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : 'chain error';
  return { error: 'Unknown', raw: message.slice(0, 300) };
}

function field(value: unknown, key: string, index: number): unknown {
  if (Array.isArray(value)) return value[index];
  return asRecord(value)?.[key];
}

function bigintField(value: unknown, key: string, index: number): bigint {
  const raw = field(value, key, index);
  if (typeof raw !== 'bigint') throw new Error(`expected bigint for ${key}`);
  return raw;
}

function addressField(value: unknown, key: string, index: number): Address {
  const raw = field(value, key, index);
  if (typeof raw !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(raw)) throw new Error(`expected address for ${key}`);
  return raw as Address;
}

function numberField(value: unknown, key: string, index: number): number {
  const raw = field(value, key, index);
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'bigint') return Number(raw);
  throw new Error(`expected number for ${key}`);
}

/** Real EVM adapter. Reads are public; writes use the executor or owner signer. */
export class ViemChainPort implements ChainPort, MandateWriter {
  private readonly config: ViemChainPortConfig;
  private readonly publicClient: PublicClient;
  private readonly executorWallet: WalletClient;
  private readonly ownerWallet?: WalletClient;
  private readonly executorAccount: Account | Address;
  private readonly ownerAccount?: Account | Address;
  private readonly submitted = new Map<string, Action>();
  private readonly receiptTimeoutMs: number;
  private readonly confirmations: number;

  constructor(config: ViemChainPortConfig) {
    this.config = config;
    const chain = defineChain({
      id: config.chainId,
      name: `chain-${config.chainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    });
    this.publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
    this.executorAccount = ViemChainPort.account(config.executorSigner);
    this.executorWallet = createWalletClient({
      account: this.executorAccount,
      chain,
      transport: http(config.rpcUrl),
    });
    if (config.ownerSigner) {
      this.ownerAccount = ViemChainPort.account(config.ownerSigner);
      this.ownerWallet = createWalletClient({
        account: this.ownerAccount,
        chain,
        transport: http(config.rpcUrl),
      });
    }
    this.receiptTimeoutMs = config.receiptTimeoutMs ?? 120_000;
    this.confirmations = config.confirmations ?? 1;
  }

  private owner(): { wallet: WalletClient; account: Account | Address } {
    if (!this.ownerWallet || this.ownerAccount === undefined) throw new OwnerSignerNotConfiguredError();
    return { wallet: this.ownerWallet, account: this.ownerAccount };
  }

  private static account(
    signer: { kind: 'privateKey'; value: Hex } | { kind: 'address'; value: Address },
  ): Account | Address {
    return signer.kind === 'privateKey' ? privateKeyToAccount(signer.value) : signer.value;
  }

  /**
   * Reads a state snapshot at one explicit block.
   *
   * A public RPC is usually load-balanced over nodes with different sync
   * heights, so a snapshot assembled from separate "latest" calls can mix a
   * fresh head with a lagging node's state. That produced a vault snapshot
   * whose `activeMandateId` and `spentUsd` came from different mandates, and
   * the planner then refused to act on a budget that was already spent.
   * Reading every field at the same block removes that class of mismatch: if
   * the node cannot serve the block, the read fails and is retried.
   */
  private async snapshotAt<T>(read: (blockNumber: bigint) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const blockNumber = await this.publicClient.getBlockNumber({ cacheTime: 0 });
      try {
        return await read(blockNumber);
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('could not read a consistent chain snapshot');
  }

  async getVault(): Promise<VaultSnapshot> {
    return this.snapshotAt(async (headBlockNumber) => {
      const [paused, activeMandateId, actionNonce, liquidReserveUsd8] = await Promise.all([
        this.publicClient.readContract({
          address: this.config.vault,
          abi: MANDATE_VAULT_ABI,
          functionName: 'paused',
          blockNumber: headBlockNumber,
        }) as Promise<boolean>,
        this.publicClient.readContract({
          address: this.config.vault,
          abi: MANDATE_VAULT_ABI,
          functionName: 'activeMandateId',
          blockNumber: headBlockNumber,
        }) as Promise<bigint>,
        this.publicClient.readContract({
          address: this.config.vault,
          abi: MANDATE_VAULT_ABI,
          functionName: 'actionNonce',
          blockNumber: headBlockNumber,
        }) as Promise<bigint>,
        this.publicClient.readContract({
          address: this.config.vault,
          abi: MANDATE_VAULT_ABI,
          functionName: 'liquidReserveUsd8',
          blockNumber: headBlockNumber,
        }) as Promise<bigint>,
      ]);
      const block = await this.publicClient.getBlock({ blockNumber: headBlockNumber });
      const [spentUsd8, balances] = await Promise.all([
        this.publicClient.readContract({
          address: this.config.vault,
          abi: MANDATE_VAULT_ABI,
          functionName: 'spentUsd',
          args: [activeMandateId],
          blockNumber: headBlockNumber,
        }) as Promise<bigint>,
        Promise.all(
          this.config.tokens.map(
            async (token) =>
              [
                token,
                (await this.publicClient.readContract({
                  address: token,
                  abi: MOCK_ERC20_ABI,
                  functionName: 'balanceOf',
                  args: [this.config.vault],
                  blockNumber: headBlockNumber,
                })) as bigint,
              ] as const,
          ),
        ),
      ]);
      return {
        blockNumber: headBlockNumber,
        blockTimestamp: block.timestamp,
        paused,
        activeMandateId,
        actionNonce,
        spentUsd8,
        liquidReserveUsd8,
        balances: Object.fromEntries(balances) as Record<Address, bigint>,
      };
    });
  }

  async getPositions(): Promise<PositionSnapshot[]> {
    return this.snapshotAt(async (headBlockNumber) => {
      const positions: PositionSnapshot[] = [];
      for (const poolId of [0, 1] as const) {
        const [pool, position, healthFactor] = await Promise.all([
          this.publicClient.readContract({
            address: this.config.lending,
            abi: LENDING_SIM_ABI,
            functionName: 'pools',
            args: [poolId],
            blockNumber: headBlockNumber,
          }),
          this.publicClient.readContract({
            address: this.config.lending,
            abi: LENDING_SIM_ABI,
            functionName: 'positionOf',
            args: [poolId, this.config.vault],
            blockNumber: headBlockNumber,
          }),
          this.publicClient.readContract({
            address: this.config.lending,
            abi: LENDING_SIM_ABI,
            functionName: 'healthFactor',
            args: [poolId, this.config.vault],
            blockNumber: headBlockNumber,
          }) as Promise<bigint>,
        ]);
        positions.push({
          poolId,
          collateralToken: addressField(pool, 'collateralToken', 0),
          debtToken: addressField(pool, 'debtToken', 1),
          collateral: bigintField(position, 'collateral', 0),
          debt: bigintField(position, 'debt', 1),
          healthFactor,
          ltBps: numberField(pool, 'ltBps', 2),
          liqBonusBps: numberField(pool, 'liqBonusBps', 3),
          closeFactorBps: numberField(pool, 'closeFactorBps', 4),
        });
      }
      return positions;
    });
  }

  async getPrices(tokens: Address[]): Promise<PriceSnapshot[]> {
    return this.snapshotAt(async (headBlockNumber) =>
      Promise.all(
        tokens.map(async (token) => {
          const price = await this.publicClient.readContract({
            address: this.config.oracle,
            abi: MOCK_ORACLE_ABI,
            functionName: 'getPrice',
            args: [token],
            blockNumber: headBlockNumber,
          });
          return {
            token,
            priceUsd8: bigintField(price, 'priceUsd8', 0),
            updatedAt: bigintField(price, 'updatedAt', 1),
          };
        }),
      ),
    );
  }

  async getNextMandateId(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.config.vault,
      abi: MANDATE_VAULT_ABI,
      functionName: 'nextMandateId',
    })) as bigint;
  }

  async getMandate(): Promise<Mandate | null> {
    const active = (await this.publicClient.readContract({
      address: this.config.vault,
      abi: MANDATE_VAULT_ABI,
      functionName: 'activeMandateId',
    })) as bigint;
    if (active === 0n) return null;
    const raw = await this.publicClient.readContract({
      address: this.config.vault,
      abi: MANDATE_VAULT_ABI,
      functionName: 'mandate',
    });
    return fromContractMandate({
      id: bigintField(raw, 'id', 0),
      validFrom: bigintField(raw, 'validFrom', 1),
      validUntil: bigintField(raw, 'validUntil', 2),
      maxTotalSpendUsd: bigintField(raw, 'maxTotalSpendUsd', 3),
      maxPerActionUsd: bigintField(raw, 'maxPerActionUsd', 4),
      minLiquidReserveUsd: bigintField(raw, 'minLiquidReserveUsd', 5),
      maxSlippageBps: numberField(raw, 'maxSlippageBps', 6),
      maxPriceAgeSec: numberField(raw, 'maxPriceAgeSec', 7),
      maxPriceDeviationBps: numberField(raw, 'maxPriceDeviationBps', 8),
      allowedActions: numberField(raw, 'allowedActions', 9),
      allowBorrow: field(raw, 'allowBorrow', 10) === true,
      allowedTargets: (field(raw, 'allowedTargets', 11) as Address[]) ?? [],
      lockedTokens: (field(raw, 'lockedTokens', 12) as Address[]) ?? [],
    });
  }

  async simulate(
    action: Action,
  ): Promise<{ ok: true; valueUsd8: bigint } | { ok: false; error: ErrorName | 'Unknown'; raw?: string }> {
    try {
      const { result } = await this.publicClient.simulateContract({
        address: this.config.vault,
        abi: MANDATE_VAULT_ABI,
        functionName: 'execute',
        args: [toContractAction(action)],
        account: this.executorAccount,
      });
      if (typeof result !== 'bigint') return { ok: false, error: 'Unknown', raw: 'execute returned no value' };
      return { ok: true, valueUsd8: result };
    } catch (error) {
      return { ok: false, ...decodeChainError(error) };
    }
  }

  async submit(action: Action): Promise<SubmitResult> {
    const hash = await this.executorWallet.writeContract({
      address: this.config.vault,
      abi: MANDATE_VAULT_ABI,
      functionName: 'execute',
      args: [toContractAction(action)],
      account: this.executorAccount,
      chain: this.executorWallet.chain,
    });
    this.submitted.set(hash.toLowerCase(), action);
    let receipt;
    try {
      receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
        confirmations: this.confirmations,
        timeout: this.receiptTimeoutMs,
      });
    } catch {
      // The transaction was broadcast; an unknown receipt is reconciled by getTx, never resent.
      return { status: 'unknown', txHash: hash };
    }
    const gasUsed = receipt.gasUsed;
    const effectiveGasPrice = receipt.effectiveGasPrice ?? 0n;
    if (receipt.status === 'success') {
      return { status: 'mined', txHash: hash, blockNumber: receipt.blockNumber, gasUsed, effectiveGasPrice };
    }
    const decoded = await this.replayAction(action, receipt.blockNumber);
    return { status: 'reverted', txHash: hash, error: decoded.error, gasUsed, effectiveGasPrice };
  }

  async getTx(hash: Hex): Promise<TxStatus> {
    let receipt;
    try {
      receipt = await this.publicClient.getTransactionReceipt({ hash });
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) {
        try {
          await this.publicClient.getTransaction({ hash });
          return { status: 'pending' };
        } catch (transactionError) {
          if (transactionError instanceof TransactionNotFoundError) return { status: 'not_found' };
          throw transactionError;
        }
      }
      throw error;
    }
    if (receipt.status === 'success') {
      return {
        status: 'mined',
        success: true,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice ?? 0n,
      };
    }
    const action = this.submitted.get(hash.toLowerCase());
    const decoded =
      action === undefined
        ? { error: 'Unknown' as const }
        : await this.replayAction(action, receipt.blockNumber);
    return {
      status: 'mined',
      success: false,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      effectiveGasPrice: receipt.effectiveGasPrice ?? 0n,
      error: decoded.error,
    };
  }

  async pause(): Promise<Hex> {
    const hash = await this.executorWallet.writeContract({
      address: this.config.vault,
      abi: MANDATE_VAULT_ABI,
      functionName: 'pause',
      account: this.executorAccount,
      chain: this.executorWallet.chain,
    });
    await this.waitForSuccess(hash);
    return hash;
  }

  async demoSetPrice(token: Address, priceUsd8: bigint, updatedAt?: bigint): Promise<Hex> {
    const { wallet, account } = this.owner();
    const hash =
      updatedAt === undefined
        ? await wallet.writeContract({
            address: this.config.oracle,
            abi: MOCK_ORACLE_ABI,
            functionName: 'setPrice',
            args: [token, priceUsd8],
            account,
            chain: wallet.chain,
          })
        : await wallet.writeContract({
            address: this.config.oracle,
            abi: MOCK_ORACLE_ABI,
            functionName: 'setPriceAt',
            args: [token, priceUsd8, updatedAt],
            account,
            chain: wallet.chain,
          });
    await this.waitForSuccess(hash);
    return hash;
  }

  async demoSetPoolPaused(pool: number, paused: boolean): Promise<Hex> {
    const { wallet, account } = this.owner();
    const hash = await wallet.writeContract({
      address: this.config.lending,
      abi: LENDING_SIM_ABI,
      functionName: 'setPoolPaused',
      args: [pool, paused],
      account,
      chain: wallet.chain,
    });
    await this.waitForSuccess(hash);
    return hash;
  }

  async demoSetSwapBroken(broken: boolean): Promise<Hex> {
    const { wallet, account } = this.owner();
    const hash = await wallet.writeContract({
      address: this.config.swap,
      abi: MOCK_SWAP_ABI,
      functionName: 'setBroken',
      args: [broken],
      account,
      chain: wallet.chain,
    });
    await this.waitForSuccess(hash);
    return hash;
  }

  /**
   * Owner-admin repair of the demo market: unpause the vault and pools, reseed both positions,
   * restamp prices and top the vault reserve up. Refuses while no owner signer is configured.
   * Sequential transactions; a failure throws and leaves the rest undone (call again to resume).
   */
  async demoResetMarket(baseline: MarketBaseline): Promise<Hex[]> {
    const { wallet, account } = this.owner();
    const hashes: Hex[] = [];
    const send = async (request: Parameters<WalletClient['writeContract']>[0]): Promise<void> => {
      const hash = await wallet.writeContract(request);
      await this.waitForSuccess(hash);
      hashes.push(hash);
    };
    const vault = await this.getVault();
    if (vault.paused) {
      await send({ address: this.config.vault, abi: MANDATE_VAULT_ABI, functionName: 'unpause', args: [], account, chain: wallet.chain });
    }
    for (const poolId of [0, 1]) {
      const pool = (await this.publicClient.readContract({
        address: this.config.lending, abi: LENDING_SIM_ABI, functionName: 'pools', args: [poolId],
      })) as readonly unknown[];
      if (pool[5] === true) {
        await send({ address: this.config.lending, abi: LENDING_SIM_ABI, functionName: 'setPoolPaused', args: [poolId, false], account, chain: wallet.chain });
      }
    }
    const swapBroken = (await this.publicClient.readContract({
      address: this.config.swap, abi: MOCK_SWAP_ABI, functionName: 'broken', args: [],
    }).catch(() => false)) as boolean;
    if (swapBroken) {
      await send({ address: this.config.swap, abi: MOCK_SWAP_ABI, functionName: 'setBroken', args: [false], account, chain: wallet.chain });
    }
    for (const position of baseline.positions) {
      await send({
        address: this.config.lending, abi: LENDING_SIM_ABI, functionName: 'seedPosition',
        args: [position.poolId, this.config.vault, position.collateral, position.debt], account, chain: wallet.chain,
      });
    }
    for (const price of baseline.prices) {
      await send({ address: this.config.oracle, abi: MOCK_ORACLE_ABI, functionName: 'setPrice', args: [price.token, price.priceUsd8], account, chain: wallet.chain });
    }
    const balance = (await this.publicClient.readContract({
      address: baseline.reserve.token, abi: MOCK_ERC20_ABI, functionName: 'balanceOf', args: [this.config.vault],
    })) as bigint;
    if (balance < baseline.reserve.amount) {
      await send({
        address: baseline.reserve.token, abi: MOCK_ERC20_ABI, functionName: 'mint',
        args: [this.config.vault, baseline.reserve.amount - balance], account, chain: wallet.chain,
      });
    }
    return hashes;
  }

  async executorBalance(): Promise<bigint> {
    const address = typeof this.executorAccount === 'string' ? this.executorAccount : this.executorAccount.address;
    return this.publicClient.getBalance({ address });
  }

  async setMandateWithSig(mandate: Mandate, deadline: bigint, signature: Hex): Promise<SubmitResult> {
    const { wallet, account } = this.owner();
    const hash = await wallet.writeContract({
      address: this.config.vault,
      abi: MANDATE_VAULT_ABI,
      functionName: 'setMandateWithSig',
      args: [mandate, deadline, signature],
      account,
      chain: wallet.chain,
    });
    let receipt;
    try {
      receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
        confirmations: this.confirmations,
        timeout: this.receiptTimeoutMs,
      });
    } catch {
      return { status: 'unknown', txHash: hash };
    }
    const gasUsed = receipt.gasUsed;
    const effectiveGasPrice = receipt.effectiveGasPrice ?? 0n;
    if (receipt.status === 'success') {
      return { status: 'mined', txHash: hash, blockNumber: receipt.blockNumber, gasUsed, effectiveGasPrice };
    }
    let decoded: { error: ErrorName | 'Unknown'; raw?: string } = { error: 'Unknown' };
    try {
      await this.publicClient.simulateContract({
        address: this.config.vault,
        abi: MANDATE_VAULT_ABI,
        functionName: 'setMandateWithSig',
        args: [mandate, deadline, signature],
        account,
        blockNumber: receipt.blockNumber > 0n ? receipt.blockNumber - 1n : undefined,
      });
    } catch (error) {
      decoded = decodeChainError(error);
    }
    return { status: 'reverted', txHash: hash, error: decoded.error, gasUsed, effectiveGasPrice };
  }

  private async replayAction(
    action: Action,
    blockNumber: bigint,
  ): Promise<{ error: ErrorName | 'Unknown'; raw?: string }> {
    try {
      await this.publicClient.call({
        account: this.config.executor,
        to: this.config.vault,
        data: encodeFunctionData({
          abi: MANDATE_VAULT_ABI,
          functionName: 'execute',
          args: [toContractAction(action)],
        }),
        blockNumber: blockNumber > 0n ? blockNumber - 1n : undefined,
      });
      return { error: 'Unknown', raw: 'replay did not revert' };
    } catch (error) {
      return decodeChainError(error);
    }
  }

  private async waitForSuccess(hash: Hex): Promise<void> {
    let receipt;
    try {
      receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
        confirmations: this.confirmations,
        timeout: this.receiptTimeoutMs,
      });
    } catch {
      throw new ChainTransactionError(
        hash,
        `transaction ${hash} was broadcast but not confirmed within ${this.receiptTimeoutMs}ms; reconcile before retrying`,
      );
    }
    if (receipt.status !== 'success') {
      throw new ChainTransactionError(hash, `transaction ${hash} reverted`);
    }
  }
}
