import { MockChainPort, type ChainPort } from '@marginpilot/core';

import { demoChainConfig } from '../demo/fixtures.js';
import type { TokenRegistry } from '../mandate/registry.js';

export type ChainMode = 'demo' | 'anvil';

export interface CreateChainPortOptions {
  mode: ChainMode;
  registry: TokenRegistry;
}

/**
 * Select the chain port explicitly. There is no silent fallback: a production
 * mode without a Viem implementation fails closed instead of pretending.
 */
export function createChainPort(options: CreateChainPortOptions): ChainPort {
  if (options.mode === 'demo') {
    return new MockChainPort(demoChainConfig(options.registry));
  }
  throw new Error('anvil chain port is not available until B-08/A-07 artifacts exist');
}

export function createDemoChain(registry: TokenRegistry): MockChainPort {
  return new MockChainPort(demoChainConfig(registry));
}
