import {
  type Address,
  type Hex,
  type Mandate,
  type MandateDraft,
  type PositionSnapshot,
} from '@marginpilot/core';
import { privateKeyToAccount } from 'viem/accounts';

import { createDemoChain } from '../chain/factory.js';
import { ScriptedLlm } from '../llm/scripted.js';
import { assertDraftConfirmable, compileMandate } from '../mandate/compile.js';
import { LOCAL_TEST_REGISTRY, type TokenRegistry } from '../mandate/registry.js';
import { DEMO_VAULT } from './fixtures.js';

const DOMAIN_NAME = 'MarginPilotVault';
const DOMAIN_VERSION = '1';

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
    super('DEMO_OWNER_PRIVATE_KEY is not configured; owner confirmation is unavailable');
    this.name = 'DemoSignerNotConfiguredError';
  }
}

export interface DemoRuntimeOptions {
  registry?: TokenRegistry;
  demoOwnerPrivateKey?: string;
  now?: () => bigint;
}

export interface DemoNote {
  source: 'poison';
  text: string;
  ts: number;
}

/** In-memory demo runtime. All chain state is SIMULATED by `MockChainPort`. */
export class DemoRuntime {
  readonly chain;
  readonly registry: TokenRegistry;
  readonly notes: DemoNote[] = [];
  private readonly demoOwnerPrivateKey?: string;
  private readonly now: () => bigint;

  constructor(options: DemoRuntimeOptions = {}) {
    this.registry = options.registry ?? LOCAL_TEST_REGISTRY;
    this.chain = createDemoChain(this.registry);
    this.demoOwnerPrivateKey = options.demoOwnerPrivateKey;
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

  async confirm(draft: MandateDraft): Promise<{ txHash: Hex; mandateId: bigint; signature: Hex; simulated: true }> {
    assertDraftConfirmable(draft);
    const key = this.demoOwnerPrivateKey;
    if (!key) throw new DemoSignerNotConfiguredError();
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new DemoSignerNotConfiguredError();

    const vault = await this.chain.getVault();
    const mandate: Mandate = { ...draft.mandate, id: vault.activeMandateId + 1n };
    const account = privateKeyToAccount(key as Hex);
    const deadline = this.now() + 3_600n;
    const signature = await account.signTypedData({
      domain: {
        name: DOMAIN_NAME,
        version: DOMAIN_VERSION,
        chainId: this.registry.chainId,
        verifyingContract: DEMO_VAULT,
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
    });

    // SIMULATED: installs the mandate in MockChainPort, not in a deployed vault.
    const txHash = await this.chain.demoSetMandate(mandate);
    return { txHash, mandateId: mandate.id, signature, simulated: true };
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
    return this.chain.demoSetPrice(token, priceUsd8, updatedAt);
  }

  async inject(kind: 'poolPause' | 'swapBroken' | 'stalePrice' | 'poisonNote', value: unknown): Promise<unknown> {
    if (kind === 'poolPause') {
      const pool = Number(value);
      if (pool !== 0 && pool !== 1) throw new Error('pool must be 0 or 1');
      return { txHash: await this.chain.demoSetPoolPaused(pool, true) };
    }
    if (kind === 'swapBroken') {
      return { txHash: await this.chain.demoSetSwapBroken(value !== false) };
    }
    if (kind === 'stalePrice') {
      const token = typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
        ? (value as Address)
        : this.registry.tokens.mWETH;
      const current = await this.chain.getPrices([token]);
      const price = current[0];
      if (!price) throw new Error('unknown token');
      return {
        txHash: await this.chain.demoSetPrice(
          token,
          price.priceUsd8,
          price.updatedAt - 10_000n,
        ),
      };
    }
    if (kind === 'poisonNote') {
      const text = String(value ?? '').slice(0, 500);
      this.notes.push({ source: 'poison', text, ts: Date.now() });
      if (this.notes.length > 20) this.notes.shift();
      return { ok: true, notesCount: this.notes.length };
    }
    throw new Error('unknown injection kind');
  }

  async pause(): Promise<Hex> {
    return this.chain.pause();
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
