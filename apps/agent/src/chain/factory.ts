import { MockChainPort, type Address, type ChainPort } from '@marginpilot/core';

import { signerAddress, type Signer } from '../config.js';
import { demoChainConfig } from '../demo/fixtures.js';
import type { TokenRegistry } from '../mandate/registry.js';
import { ViemChainPort } from './viem-port.js';

export type ChainMode = 'demo' | 'chain' | 'anvil';

export interface CreateDemoOptions {
  mode?: 'demo';
  registry: TokenRegistry;
}

export interface CreateViemOptions {
  mode: 'chain' | 'anvil';
  registry: TokenRegistry;
  chainId: number;
  rpcUrl: string;
  executorSigner: Signer;
  /** Read-only startup may omit the owner; writes then fail at the vault, never silently. */
  ownerSigner?: Signer;
  receiptTimeoutMs?: number;
  confirmations?: number;
}

export type CreateChainPortOptions = CreateDemoOptions | CreateViemOptions;

/**
 * Select the chain port explicitly. There is no silent fallback: chain mode
 * without complete deployment metadata fails closed instead of pretending.
 */
export function createChainPort(options: CreateChainPortOptions): ChainPort {
  if (!('rpcUrl' in options)) {
    return new MockChainPort(demoChainConfig(options.registry));
  }
  const { registry } = options;
  if (registry.chainId !== options.chainId) {
    throw new Error(`deployment chainId ${registry.chainId} does not match configured chain ${options.chainId}`);
  }
  if (!registry.owner) throw new Error('deployment owner is missing from the deployment record');
  const executorAddress = signerAddress(options.executorSigner);
  if (registry.executor && registry.executor.toLowerCase() !== executorAddress.toLowerCase()) {
    throw new Error('the configured executor signer does not match the deployment executor');
  }
  if (options.ownerSigner && signerAddress(options.ownerSigner).toLowerCase() !== registry.owner.toLowerCase()) {
    throw new Error('the configured owner signer does not match the deployment owner');
  }
  const tokens: Address[] = [registry.tokens.mUSDC, registry.tokens.mWETH, registry.tokens.mWSTETH];
  return new ViemChainPort({
    chainId: options.chainId,
    rpcUrl: options.rpcUrl,
    vault: registry.targets.vault,
    oracle: registry.targets.oracle,
    lending: registry.targets.lending,
    swap: registry.targets.swap,
    owner: registry.owner,
    executor: registry.executor ?? executorAddress,
    tokens,
    tokenDecimals: {
      [registry.tokens.mUSDC]: 6,
      [registry.tokens.mWETH]: 18,
      [registry.tokens.mWSTETH]: 18,
    },
    reserveToken: registry.tokens.mUSDC,
    executorSigner: options.executorSigner,
    ...(options.ownerSigner ? { ownerSigner: options.ownerSigner } : {}),
    ...(options.receiptTimeoutMs ? { receiptTimeoutMs: options.receiptTimeoutMs } : {}),
    ...(options.confirmations ? { confirmations: options.confirmations } : {}),
  });
}

export function createDemoChain(registry: TokenRegistry): MockChainPort {
  return new MockChainPort(demoChainConfig(registry));
}
