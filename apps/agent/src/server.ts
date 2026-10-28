import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPublicClient, http, parseAbi } from 'viem';

import { buildServer } from './api/server.js';
import { createChainPort } from './chain/factory.js';
import {
  ConfigError,
  loadConfig,
  loadDotEnv,
  selectSigners,
  signerAddress,
  signerPrivateKey,
} from './config.js';
import { DemoRuntime } from './demo/runtime.js';
import { loadTokenRegistry } from './mandate/registry.js';
import { AgentRuntime } from './runtime.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
loadDotEnv(ROOT);

async function main() {
  const config = loadConfig(process.env);

  if (config.mode === 'simulated') {
    const demoKey = signerPrivateKey(config.ownerSigner) ?? signerPrivateKey(config.deployerSigner);
    const runtime = new DemoRuntime({
      ...(demoKey ? { demoOwnerPrivateKey: demoKey } : {}),
    });
    const app = await buildServer({
      demoMode: config.demoMode,
      runtime,
      rateLimitCapacity: config.rateLimitCapacity,
      rateLimitRefillPerSecond: config.rateLimitRefillPerSecond,
      runLimitCapacity: config.runLimitCapacity,
      runLimitRefillPerSecond: config.runLimitRefillPerSecond,
    });
    await app.listen({ port: config.port, host: config.host });
    console.log(`MarginPilot listening on http://${config.host}:${config.port} (SIMULATED demo mode)`);
    return app;
  }

  const registry = await loadTokenRegistry(config.chainId);
  if (!registry.owner || !registry.executor) {
    throw new ConfigError(`deployment record for chain ${config.chainId} is missing owner or executor`);
  }
  const explorerBase = config.explorerBase ?? registry.explorerBase;
  if (explorerBase !== '' && !/^https?:\/\/[^\s]+$/i.test(explorerBase)) {
    throw new ConfigError('explorer base URL must start with http:// or https://');
  }
  const signers = selectSigners(config, registry);

  const publicClient = createPublicClient({ transport: http(config.rpcUrl) });
  const remoteChainId = await publicClient.getChainId().catch(() => {
    throw new ConfigError(`RPC_URL for chain ${config.chainId} is unreachable`);
  });
  if (remoteChainId !== config.chainId) {
    throw new ConfigError(`RPC chain id ${remoteChainId} does not match CHAIN_ID ${config.chainId}`);
  }

  const deployed = [
    registry.targets.vault,
    registry.targets.lending,
    registry.targets.oracle,
    registry.targets.swap,
    registry.tokens.mUSDC,
    registry.tokens.mWETH,
    registry.tokens.mWSTETH,
  ];
  const codes = await Promise.all(deployed.map((address) => publicClient.getCode({ address })));
  const missing = deployed.filter((_, index) => !codes[index] || codes[index] === '0x');
  if (missing.length > 0) {
    throw new ConfigError(
      `no contract code for chain ${config.chainId} at ${missing.join(', ')}; wrong deployment record or chain`,
    );
  }

  const roleAbi = parseAbi([
    'function owner() view returns (address)',
    'function executor() view returns (address)',
  ]);
  const [onchainOwner, onchainExecutor] = await Promise.all([
    publicClient.readContract({
      address: registry.targets.vault,
      abi: roleAbi,
      functionName: 'owner',
    }),
    publicClient.readContract({
      address: registry.targets.vault,
      abi: roleAbi,
      functionName: 'executor',
    }),
  ]);
  if (onchainOwner.toLowerCase() !== registry.owner.toLowerCase()) {
    throw new ConfigError(
      `deployment owner ${registry.owner} does not match vault owner ${onchainOwner}; refusing to start`,
    );
  }
  if (onchainExecutor.toLowerCase() !== registry.executor.toLowerCase()) {
    throw new ConfigError(
      `deployment executor ${registry.executor} does not match vault executor ${onchainExecutor}; refusing to start`,
    );
  }
  if (signerAddress(signers.executorSigner).toLowerCase() !== onchainExecutor.toLowerCase()) {
    throw new ConfigError('EXECUTOR_PRIVATE_KEY/address does not match the on-chain executor; refusing to start');
  }
  if (signers.ownerSigner && signerAddress(signers.ownerSigner).toLowerCase() !== onchainOwner.toLowerCase()) {
    throw new ConfigError('owner signer does not match the on-chain owner; refusing to start');
  }

  const chain = createChainPort({
    mode: config.mode,
    registry,
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    executorSigner: signers.executorSigner,
    ...(signers.ownerSigner ? { ownerSigner: signers.ownerSigner } : {}),
  });
  const runtime = new AgentRuntime({
    registry,
    chain,
    simulated: false,
    chainLabel: config.chainLabel,
    allowDemoControls: config.allowDemoControls,
    vaultAddress: registry.targets.vault,
    explorerBase,
    ...(signerPrivateKey(signers.ownerSigner)
      ? { ownerPrivateKey: signerPrivateKey(signers.ownerSigner) as `0x${string}` }
      : {}),
  });
  const app = await buildServer({
    demoMode: config.demoMode,
    runtime,
    rateLimitCapacity: config.rateLimitCapacity,
    rateLimitRefillPerSecond: config.rateLimitRefillPerSecond,
    runLimitCapacity: config.runLimitCapacity,
    runLimitRefillPerSecond: config.runLimitRefillPerSecond,
    trustProxy: config.trustProxy,
    allowedOrigins: config.allowedOrigins,
    runCooldownMs: config.runCooldownMs,
    pauseCooldownMs: config.pauseCooldownMs,
    resetCooldownMs: config.resetCooldownMs,
    minExecutorBalanceWei: config.minExecutorBalanceWei,
  });
  await app.listen({ port: config.port, host: config.host });
  console.log(
    `MarginPilot listening on http://${config.host}:${config.port} ` +
      `(chain ${config.chainId}, vault ${registry.targets.vault}, executor ${signerAddress(signers.executorSigner)})`,
  );
  return app;
}

const app = await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'startup failed';
  console.error(`MarginPilot failed to start: ${message}`);
  process.exit(1);
});

const close = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
