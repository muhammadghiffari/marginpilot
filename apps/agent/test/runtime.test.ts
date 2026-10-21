import {
  type ChainPort,
  type Mandate,
  type MandateDraft,
  type SubmitResult,
} from '@marginpilot/core';
import { describe, expect, test, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';

import { LOCAL_TEST_REGISTRY, type TokenRegistry } from '../src/mandate/registry.js';
import {
  AgentRuntime,
  DemoSignerNotConfiguredError,
  InvalidOwnerSignatureError,
  MandateDraftMismatchError,
  MandateTxUnknownError,
  OwnerSignerMismatchError,
  mandateTypedData,
} from '../src/runtime.js';

const OWNER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const HASH = `0x${'11'.repeat(32)}`;

const draft: MandateDraft = {
  mandate: {
    validFrom: 1_000n,
    validUntil: 100_000n,
    maxTotalSpendUsd: 26_000_000_000n,
    maxPerActionUsd: 26_000_000_000n,
    minLiquidReserveUsd: 10_000_000_000n,
    maxSlippageBps: 100,
    maxPriceAgeSec: 600,
    maxPriceDeviationBps: 300,
    allowedActions: 3,
    allowBorrow: false,
    allowedTargets: [LOCAL_TEST_REGISTRY.targets.lending],
    lockedTokens: [LOCAL_TEST_REGISTRY.tokens.mWETH],
  },
  humanSummary: 'test',
  clarifications: [],
  assumptions: [],
};

function registry(owner = OWNER): TokenRegistry {
  return { ...LOCAL_TEST_REGISTRY, owner };
}

function fakeChain(overrides: Partial<ChainPort> = {}): ChainPort {
  const mined: SubmitResult = {
    status: 'mined',
    txHash: HASH as `0x${string}`,
    blockNumber: 10n,
    gasUsed: 100n,
    effectiveGasPrice: 1n,
  };
  const chain: ChainPort = {
    getVault: async () => ({
      blockNumber: 9n,
      blockTimestamp: 50_000n,
      paused: false,
      activeMandateId: 4n,
      actionNonce: 0n,
      spentUsd8: 0n,
      liquidReserveUsd8: 40_000_000_000n,
      balances: {},
    }),
    getPositions: async () => [],
    getPrices: async (tokens) => tokens.map((token) => ({ token, priceUsd8: 100_000_000n, updatedAt: 50_000n })),
    getMandate: async () => null,
    getNextMandateId: async () => 5n,
    simulate: async () => ({ ok: true, valueUsd8: 1n }),
    submit: async () => mined,
    getTx: async () => ({ status: 'not_found' }),
    pause: async () => HASH as `0x${string}`,
    demoSetPrice: async () => HASH as `0x${string}`,
    demoSetPoolPaused: async () => HASH as `0x${string}`,
    setMandateWithSig: async () => mined,
    ...overrides,
  };
  return chain;
}

describe('AgentRuntime owner confirmation', () => {
  test('reconciles an unknown mandate receipt instead of reporting a failed install', async () => {
    const unknown: SubmitResult = { status: 'unknown', txHash: HASH as `0x${string}` };
    const getTx = vi.fn(async () => ({
      status: 'mined' as const,
      success: true,
      blockNumber: 11n,
      gasUsed: 100n,
      effectiveGasPrice: 1n,
    }));
    const runtime = new AgentRuntime({
      registry: registry(),
      chain: fakeChain({ setMandateWithSig: async () => unknown, getTx }),
      simulated: false,
      ownerPrivateKey: OWNER_KEY,
      vaultAddress: LOCAL_TEST_REGISTRY.targets.vault,
    });

    const confirmed = await runtime.confirm(draft);

    expect(confirmed.txHash).toBe(HASH);
    expect(confirmed.mandateId).toBe(5n);
    expect(getTx).toHaveBeenCalledWith(HASH);
  });

  test('reports an unknown mandate receipt honestly when it cannot be reconciled', async () => {
    const unknown: SubmitResult = { status: 'unknown', txHash: HASH as `0x${string}` };
    const runtime = new AgentRuntime({
      registry: registry(),
      chain: fakeChain({ setMandateWithSig: async () => unknown, getTx: async () => ({ status: 'pending' }) }),
      simulated: false,
      ownerPrivateKey: OWNER_KEY,
      vaultAddress: LOCAL_TEST_REGISTRY.targets.vault,
    });

    await expect(runtime.confirm(draft)).rejects.toBeInstanceOf(MandateTxUnknownError);
  });

  test('signs with the deployment vault domain and submits the next mandate id', async () => {
    const setMandateWithSig = vi.fn(async (_mandate: Mandate) => ({
      status: 'mined' as const,
      txHash: HASH as `0x${string}`,
      blockNumber: 10n,
      gasUsed: 100n,
      effectiveGasPrice: 1n,
    }));
    const runtime = new AgentRuntime({
      registry: registry(),
      chain: fakeChain({ setMandateWithSig }),
      simulated: false,
      ownerPrivateKey: OWNER_KEY,
      vaultAddress: LOCAL_TEST_REGISTRY.targets.vault,
    });
    const confirmed = await runtime.confirm(draft);
    expect(confirmed.mandateId).toBe(5n);
    expect(confirmed.simulated).toBe(false);
    expect(confirmed.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(setMandateWithSig).toHaveBeenCalledTimes(1);
    expect(setMandateWithSig.mock.calls[0]?.[0].id).toBe(5n);
  });

  test('rejects an owner key that does not match the deployment owner', async () => {
    const runtime = new AgentRuntime({
      registry: registry('0x00000000000000000000000000000000000000e3'),
      chain: fakeChain(),
      simulated: false,
      ownerPrivateKey: OWNER_KEY,
      vaultAddress: LOCAL_TEST_REGISTRY.targets.vault,
    });
    await expect(runtime.confirm(draft)).rejects.toBeInstanceOf(OwnerSignerMismatchError);
  });

  test('fails closed without a configured key', async () => {
    const runtime = new AgentRuntime({
      registry: registry(),
      chain: fakeChain(),
      simulated: false,
      vaultAddress: LOCAL_TEST_REGISTRY.targets.vault,
    });
    await expect(runtime.confirm(draft)).rejects.toBeInstanceOf(DemoSignerNotConfiguredError);
  });

  test('prepares and relays a browser-wallet signature after verifying the owner', async () => {
    const setMandateWithSig = vi.fn(async () => ({
      status: 'mined' as const,
      txHash: HASH as `0x${string}`,
      blockNumber: 10n,
      gasUsed: 100n,
      effectiveGasPrice: 1n,
    }));
    const runtime = new AgentRuntime({
      registry: registry(),
      chain: fakeChain({ setMandateWithSig }),
      simulated: false,
      vaultAddress: LOCAL_TEST_REGISTRY.targets.vault,
    });
    const prepared = await runtime.prepareWallet(draft);
    expect(prepared.mandate.id).toBe(5n);
    const signature = await privateKeyToAccount(OWNER_KEY).signTypedData(prepared.typedData);
    const confirmed = await runtime.confirmWithSignature(draft, signature, prepared.mandate, prepared.deadline);
    expect(confirmed.txHash).toBe(HASH);
    expect(setMandateWithSig.mock.calls[0]?.[2]).toBe(signature);
  });

  test('rejects a browser-wallet signature from a different key', async () => {
    const runtime = new AgentRuntime({
      registry: registry(),
      chain: fakeChain(),
      simulated: false,
      vaultAddress: LOCAL_TEST_REGISTRY.targets.vault,
    });
    const prepared = await runtime.prepareWallet(draft);
    const signature = await privateKeyToAccount(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    ).signTypedData(prepared.typedData);
    await expect(
      runtime.confirmWithSignature(draft, signature, prepared.mandate, prepared.deadline),
    ).rejects.toBeInstanceOf(InvalidOwnerSignatureError);
  });

  test('rejects a signed mandate that differs from the reviewed draft', async () => {
    const runtime = new AgentRuntime({
      registry: registry(),
      chain: fakeChain(),
      simulated: false,
      vaultAddress: LOCAL_TEST_REGISTRY.targets.vault,
    });
    const prepared = await runtime.prepareWallet(draft);
    const widened = { ...prepared.mandate, maxTotalSpendUsd: prepared.mandate.maxTotalSpendUsd + 1n };
    const signature = await privateKeyToAccount(OWNER_KEY).signTypedData(
      mandateTypedData(
        LOCAL_TEST_REGISTRY.chainId,
        LOCAL_TEST_REGISTRY.targets.vault,
        widened,
        prepared.deadline,
      ),
    );
    await expect(
      runtime.confirmWithSignature(draft, signature, widened, prepared.deadline),
    ).rejects.toBeInstanceOf(MandateDraftMismatchError);
  });

  test('does not retry a non-mined mandate transaction', async () => {
    const runtime = new AgentRuntime({
      registry: registry(),
      chain: fakeChain({
        setMandateWithSig: async () => ({
          status: 'unknown' as const,
          txHash: HASH as `0x${string}`,
        }),
      }),
      simulated: false,
      ownerPrivateKey: OWNER_KEY,
      vaultAddress: LOCAL_TEST_REGISTRY.targets.vault,
    });
    await expect(runtime.confirm(draft)).rejects.toThrow(/receipt is unknown; it was not retried/);
  });

  test('demo controls fail closed when disabled', async () => {
    const runtime = new AgentRuntime({
      registry: registry(),
      chain: fakeChain(),
      simulated: false,
      allowDemoControls: false,
      vaultAddress: LOCAL_TEST_REGISTRY.targets.vault,
    });
    await expect(runtime.shock(LOCAL_TEST_REGISTRY.tokens.mWETH, 1n)).rejects.toThrow(/disabled/);
  });
});
