import {
  type Address,
  type ChainPort,
  type Hex,
  type Mandate,
  type MandateDraft,
  type PositionSnapshot,
  type SubmitResult,
} from '@marginpilot/core';
import { recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { createDemoChain } from './chain/factory.js';
import { ScriptedLlm } from './llm/scripted.js';
import { assertDraftConfirmable, compileMandate } from './mandate/compile.js';
import { LOCAL_TEST_REGISTRY, type TokenRegistry } from './mandate/registry.js';

const DOMAIN_NAME = 'MarginPilotVault';
const DOMAIN_VERSION = '1';

function sameAddressList(left: readonly Address[], right: readonly Address[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value.toLowerCase() === right[index]?.toLowerCase());
}

function sameMandate(mandate: Mandate, draft: MandateDraft): boolean {
  const expected = draft.mandate;
  return (
    mandate.validFrom === expected.validFrom &&
    mandate.validUntil === expected.validUntil &&
    mandate.maxTotalSpendUsd === expected.maxTotalSpendUsd &&
    mandate.maxPerActionUsd === expected.maxPerActionUsd &&
    mandate.minLiquidReserveUsd === expected.minLiquidReserveUsd &&
    mandate.maxSlippageBps === expected.maxSlippageBps &&
    mandate.maxPriceAgeSec === expected.maxPriceAgeSec &&
    mandate.maxPriceDeviationBps === expected.maxPriceDeviationBps &&
    mandate.allowedActions === expected.allowedActions &&
    mandate.allowBorrow === expected.allowBorrow &&
    sameAddressList(mandate.allowedTargets, expected.allowedTargets) &&
    sameAddressList(mandate.lockedTokens, expected.lockedTokens)
  );
}

/** The exact EIP-712 payload the deployment owner must sign. */
export function mandateTypedData(
  chainId: number,
  vault: Address,
  mandate: Mandate,
  deadline: bigint,
): MandateTypedData {
  return {
    domain: {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId,
      verifyingContract: vault,
    },
    types: {
      Mandate: [
        { name: 'id', type: 'uint64' },
        { name: 'validFrom', type: 'uint64' },
        { name: 'validUntil', type: 'uint64' },
        { name: 'maxTotalSpendUsd', type: 'uint128' },
        { name: 'maxPerActionUsd', type: 'uint128' },
        { name: 'minLiquidReserveUsd', type: 'uint128' },
        { name: 'maxSlippageBps', type: 'uint32' },
        { name: 'maxPriceAgeSec', type: 'uint32' },
        { name: 'maxPriceDeviationBps', type: 'uint32' },
        { name: 'allowedActions', type: 'uint8' },
        { name: 'allowBorrow', type: 'bool' },
        { name: 'allowedTargets', type: 'address[]' },
        { name: 'lockedTokens', type: 'address[]' },
      ],
      SetMandate: [
        { name: 'mandate', type: 'Mandate' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'SetMandate',
    message: { mandate, deadline },
  };
}

const DEMO_MODEL_OUTPUT = {
  maxTotalSpendUsd: '260',
  maxPerActionUsd: '260',
  minLiquidReserveUsd: '100',
  maxSlippageBps: 100,
  validForSec: 86_400,
  lockedTokenSymbols: ['mWETH'],
  allowedActions: ['REPAY'],
  allowBorrow: false,
  swapAllowed: false,
  unresolvedFields: [],
};

export class DemoSignerNotConfiguredError extends Error {
  constructor() {
    super('An owner signing key is not configured; owner confirmation is unavailable');
    this.name = 'DemoSignerNotConfiguredError';
  }
}

export class OwnerSignerMismatchError extends Error {
  constructor() {
    super('The configured owner key does not match the deployment owner');
    this.name = 'OwnerSignerMismatchError';
  }
}

export class InvalidOwnerSignatureError extends Error {
  constructor() {
    super('The browser-wallet signature does not recover to the deployment owner');
    this.name = 'InvalidOwnerSignatureError';
  }
}

export class MandateDraftMismatchError extends Error {
  constructor() {
    super('The signed mandate does not match the reviewed draft');
    this.name = 'MandateDraftMismatchError';
  }
}

export class MandateIdChangedError extends Error {
  constructor() {
    super('The next mandate id changed; prepare and sign a fresh mandate');
    this.name = 'MandateIdChangedError';
  }
}

export class MandateNotInstalledError extends Error {
  constructor(readonly status: SubmitResult['status']) {
    super(`mandate transaction was ${status}; it was not retried`);
    this.name = 'MandateNotInstalledError';
  }
}

export class MandateTxUnknownError extends Error {
  constructor(readonly txHash: Hex) {
    super(`mandate transaction ${txHash} was broadcast but its receipt is unknown; it was not retried`);
    this.name = 'MandateTxUnknownError';
  }
}

export interface AgentRuntimeOptions {
  registry?: TokenRegistry;
  /** Supply a real adapter for chain mode; omit for the SIMULATED in-memory chain. */
  chain?: ChainPort;
  simulated?: boolean;
  demoOwnerPrivateKey?: string;
  ownerPrivateKey?: string;
  vaultAddress?: Address;
  explorerBase?: string;
  chainLabel?: 'SIMULATED' | 'ANVIL' | 'TESTNET';
  allowDemoControls?: boolean;
  now?: () => bigint;
}

export interface DemoNote {
  source: 'poison';
  text: string;
  ts: number;
}

export interface ConfirmResult {
  txHash: Hex;
  mandateId: bigint;
  signature: Hex;
  simulated: boolean;
}

export interface MandateTypedData {
  domain: { name: string; version: string; chainId: number; verifyingContract: Address };
  types: Record<string, { name: string; type: string }[]>;
  primaryType: 'SetMandate';
  message: { mandate: Mandate; deadline: bigint };
}

export interface WalletPreparation {
  mandate: Mandate;
  deadline: bigint;
  typedData: MandateTypedData;
}

/** Shared runtime for SIMULATED (`MockChainPort`) and real (`ViemChainPort`) modes. */
export class AgentRuntime {
  readonly chain: ChainPort;
  readonly registry: TokenRegistry;
  readonly notes: DemoNote[] = [];
  readonly simulated: boolean;
  readonly vaultAddress: Address;
  readonly explorerBase: string;
  readonly chainLabel: 'SIMULATED' | 'ANVIL' | 'TESTNET';
  readonly allowDemoControls: boolean;
  private readonly ownerPrivateKey?: string;
  private readonly now: () => bigint;

  constructor(options: AgentRuntimeOptions = {}) {
    this.registry = options.registry ?? LOCAL_TEST_REGISTRY;
    this.simulated = options.simulated ?? options.chain === undefined;
    this.chain = options.chain ?? createDemoChain(this.registry);
    this.ownerPrivateKey = options.ownerPrivateKey ?? options.demoOwnerPrivateKey;
    this.vaultAddress = options.vaultAddress ?? this.registry.targets.vault;
    this.explorerBase = options.explorerBase ?? this.registry.explorerBase ?? '';
    this.chainLabel =
      options.chainLabel ??
      (this.simulated
        ? 'SIMULATED'
        : this.registry.chainId === 31337 || this.registry.chainId === 31338
          ? 'ANVIL'
          : 'TESTNET');
    this.allowDemoControls = options.allowDemoControls ?? this.simulated;
    this.now = options.now ?? (() => BigInt(Math.floor(Date.now() / 1_000)));
  }

  compileLlm(): ScriptedLlm {
    return new ScriptedLlm([{ structured: DEMO_MODEL_OUTPUT, model: 'demo-compiler' }]);
  }

  async compile(text: string): Promise<MandateDraft> {
    return compileMandate(text, this.compileLlm(), {
      registry: this.registry,
      nowSec: (await this.chain.getVault()).blockTimestamp,
    });
  }

  /** Owner confirmation with a server-side key. Never logs or returns the key. */
  async confirm(draft: MandateDraft): Promise<ConfirmResult> {
    assertDraftConfirmable(draft);
    const key = this.ownerPrivateKey;
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new DemoSignerNotConfiguredError();
    let account;
    try {
      account = privateKeyToAccount(key as Hex);
    } catch {
      throw new DemoSignerNotConfiguredError();
    }
    const owner = this.registry.owner;
    if (!this.simulated && owner !== undefined && account.address.toLowerCase() !== owner.toLowerCase()) {
      throw new OwnerSignerMismatchError();
    }
    const prepared = await this.prepareWallet(draft);
    const signature = await account.signTypedData(prepared.typedData);
    return this.install(prepared.mandate, prepared.deadline, signature);
  }

  /** Build the exact EIP-712 payload the owner wallet must sign. No transaction is sent. */
  async prepareWallet(draft: MandateDraft): Promise<WalletPreparation> {
    assertDraftConfirmable(draft);
    const mandate = await this.withNextId(draft);
    const deadline = this.now() + 3_600n;
    return { mandate, deadline, typedData: this.typedData(mandate, deadline) };
  }

  /** Relay a browser-wallet signature after verifying it against the deployment owner. */
  async confirmWithSignature(
    draft: MandateDraft,
    signature: Hex,
    mandate: Mandate,
    deadline: bigint,
  ): Promise<ConfirmResult> {
    assertDraftConfirmable(draft);
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new InvalidOwnerSignatureError();
    if (!sameMandate(mandate, draft)) throw new MandateDraftMismatchError();

    const next = this.chain.getNextMandateId
      ? await this.chain.getNextMandateId()
      : (await this.chain.getVault()).activeMandateId + 1n;
    if (mandate.id !== next) throw new MandateIdChangedError();

    if (!this.simulated) {
      const owner = this.registry.owner;
      if (owner === undefined) throw new OwnerSignerMismatchError();
      const recovered = await recoverTypedDataAddress({
        ...this.typedData(mandate, deadline),
        signature,
      });
      if (recovered.toLowerCase() !== owner.toLowerCase()) throw new InvalidOwnerSignatureError();
    }
    return this.install(mandate, deadline, signature);
  }

  async state() {
    const vault = await this.chain.getVault();
    const mandate = await this.chain.getMandate();
    const positions = await this.chain.getPositions();
    const tokens = this.tokensFor(positions);
    const prices = await this.chain.getPrices(tokens);
    return { vault, mandate, positions, prices };
  }

  async shock(token: Address, priceUsd8: bigint, updatedAt?: bigint): Promise<Hex> {
    this.requireDemoControls();
    return this.chain.demoSetPrice(token, priceUsd8, updatedAt);
  }

  async inject(kind: 'poolPause' | 'swapBroken' | 'stalePrice' | 'poisonNote', value: unknown): Promise<unknown> {
    if (kind === 'poisonNote') {
      const text = String(value ?? '').slice(0, 500);
      this.notes.push({ source: 'poison', text, ts: Date.now() });
      if (this.notes.length > 20) this.notes.shift();
      return { ok: true, notesCount: this.notes.length };
    }
    this.requireDemoControls();
    if (kind === 'poolPause') {
      const pool = Number(value);
      if (pool !== 0 && pool !== 1) throw new Error('pool must be 0 or 1');
      return { txHash: await this.chain.demoSetPoolPaused(pool, true) };
    }
    if (kind === 'swapBroken') {
      if (!this.chain.demoSetSwapBroken) throw new Error('swap controls are unavailable on this chain');
      return { txHash: await this.chain.demoSetSwapBroken(value !== false) };
    }
    const token = typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
      ? (value as Address)
      : this.registry.tokens.mWETH;
    const current = await this.chain.getPrices([token]);
    const price = current[0];
    if (!price) throw new Error('unknown token');
    return {
      txHash: await this.chain.demoSetPrice(token, price.priceUsd8, price.updatedAt - 10_000n),
    };
  }

  async pause(): Promise<Hex> {
    return this.chain.pause();
  }

  private async withNextId(draft: MandateDraft): Promise<Mandate> {
    const next = this.chain.getNextMandateId
      ? await this.chain.getNextMandateId()
      : (await this.chain.getVault()).activeMandateId + 1n;
    return { ...draft.mandate, id: next };
  }

  private async install(mandate: Mandate, deadline: bigint, signature: Hex): Promise<ConfirmResult> {
    const writer = this.chain.setMandateWithSig;
    if (!writer) throw new Error('this chain has no mandate writer');
    const result = await writer.call(this.chain, mandate, deadline, signature);
    if (result.status === 'mined') {
      return { txHash: result.txHash, mandateId: mandate.id, signature, simulated: this.simulated };
    }
    if (result.status === 'reverted') throw new MandateNotInstalledError('reverted');

    // The broadcast was accepted but the receipt timed out. Reconcile once; never resend.
    let tx;
    try {
      tx = await this.chain.getTx(result.txHash);
    } catch {
      throw new MandateTxUnknownError(result.txHash);
    }
    if (tx.status === 'mined' && tx.success) {
      return { txHash: result.txHash, mandateId: mandate.id, signature, simulated: this.simulated };
    }
    if (tx.status === 'mined') throw new MandateNotInstalledError('reverted');
    throw new MandateTxUnknownError(result.txHash);
  }

  private typedData(mandate: Mandate, deadline: bigint): MandateTypedData {
    return mandateTypedData(this.registry.chainId, this.vaultAddress, mandate, deadline);
  }

  private requireDemoControls(): void {
    if (!this.allowDemoControls) throw new Error('demo controls are disabled on this deployment');
  }

  private tokensFor(positions: PositionSnapshot[]): Address[] {
    const seen = new Map<string, Address>();
    for (const token of [
      ...positions.flatMap((position) => [position.collateralToken, position.debtToken]),
      this.registry.tokens.mUSDC,
    ]) {
      seen.set(token.toLowerCase(), token);
    }
    return [...seen.values()];
  }
}
