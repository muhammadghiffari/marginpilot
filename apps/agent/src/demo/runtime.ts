import { LOCAL_TEST_REGISTRY, type TokenRegistry } from '../mandate/registry.js';
import { AgentRuntime } from '../runtime.js';

export { DemoSignerNotConfiguredError } from '../runtime.js';
export type { DemoNote } from '../runtime.js';

export interface DemoRuntimeOptions {
  registry?: TokenRegistry;
  demoOwnerPrivateKey?: string;
  now?: () => bigint;
}

/** SIMULATED runtime: all chain state lives in `MockChainPort`. */
export class DemoRuntime extends AgentRuntime {
  constructor(options: DemoRuntimeOptions = {}) {
    const registry = options.registry ?? LOCAL_TEST_REGISTRY;
    super({
      registry,
      simulated: true,
      allowDemoControls: true,
      vaultAddress: registry.targets.vault,
      ...(options.demoOwnerPrivateKey ? { demoOwnerPrivateKey: options.demoOwnerPrivateKey } : {}),
      ...(options.now ? { now: options.now } : {}),
    });
  }
}
