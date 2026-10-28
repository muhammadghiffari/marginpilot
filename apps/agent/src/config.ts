import { resolve } from 'node:path';

import type { Address, Hex } from '@marginpilot/core';
import { privateKeyToAccount } from 'viem/accounts';

export type ChainMode = 'simulated' | 'chain';

export class ConfigError extends Error {
  constructor(message: string) {
    super(`invalid configuration: ${message}`);
    this.name = 'ConfigError';
  }
}

export interface SignerSpec {
  kind: 'privateKey';
  value: Hex;
  address: Address;
}

export interface AddressSignerSpec {
  kind: 'address';
  value: Address;
}

export type Signer = SignerSpec | AddressSignerSpec;

export interface AgentConfig {
  mode: ChainMode;
  /** Honest UI label: local anvil, a public testnet, or the in-memory simulation. */
  chainLabel: 'SIMULATED' | 'ANVIL' | 'TESTNET';
  chainId: number;
  rpcUrl: string;
  port: number;
  host: string;
  /** Demo endpoints and stricter rate limits. */
  demoMode: boolean;
  allowDemoControls: boolean;
  executorSigner?: Signer;
  /** Owner key candidate from DEMO_OWNER_PRIVATE_KEY. */
  ownerSigner?: Signer;
  /** Deployer key candidate, accepted as owner only when its address matches. */
  deployerSigner?: Signer;
  ownerAddress?: Address;
  executorAddress?: Address;
  /** Optional explorer override; the deployment record is the fallback. */
  explorerBase?: string;
  rateLimitCapacity: number;
  rateLimitRefillPerSecond: number;
  runLimitCapacity: number;
  runLimitRefillPerSecond: number;
  trustProxy: boolean;
  allowedOrigins: string[];
  runCooldownMs: number;
  pauseCooldownMs: number;
  resetCooldownMs: number;
  /** Real chains only: runs are refused when the executor holds less native balance. */
  minExecutorBalanceWei: bigint;
}

/** Chains where the public demo may expose owner-signed admin helpers (shock, reset). */
const DEMO_CONTROL_CHAIN_IDS = new Set([31337, 31338, 11155111, 84532]);

const KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function nonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new ConfigError('expected a non-negative integer in a numeric setting');
  return Number(raw.trim());
}

function nonNegativeBigint(raw: string | undefined, fallback: bigint): bigint {
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new ConfigError('expected a non-negative integer in a numeric setting');
  return BigInt(raw.trim());
}

/** Accept either a 0x-prefixed key or the bare 64-hex form used by some wallets. */
function normalizePrivateKey(raw: string): string {
  return `0x${raw.trim().replace(/^0x/i, '')}`;
}

/** AGENTS.md: mainnet is out of bounds. Refuse the well-known public mainnets. */
const MAINNET_CHAIN_IDS = new Set([
  1, 10, 25, 56, 100, 128, 137, 169, 250, 324, 1284, 1285, 5000, 8217, 8453,
  9001, 1101, 2222, 34443, 42161, 43114, 42220, 59144, 81457, 534352, 7777777,
]);
/** Fresh anvil chains used by scripts/dev-anvil.sh and scripts/e2e-anvil.sh. */
const LOCAL_CHAIN_IDS = new Set([31337, 31338]);

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(value);
}

function localChain(chainId: number): boolean {
  return LOCAL_CHAIN_IDS.has(chainId);
}

function deriveSigner(raw: string, label: string): SignerSpec {
  try {
    return { kind: 'privateKey', value: raw as Hex, address: privateKeyToAccount(raw as Hex).address };
  } catch {
    // Never include the value (or a viem error that might contain it) in the message.
    throw new ConfigError(`${label} is not a valid secp256k1 key`);
  }
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new ConfigError('expected a positive integer');
  return value;
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new ConfigError('expected a positive number');
  return value;
}

function isAddress(value: string | undefined): value is Address {
  return value !== undefined && ADDRESS_PATTERN.test(value);
}

function keySigner(raw: string | undefined, label: string, required: boolean): SignerSpec | undefined {
  if (raw === undefined || raw.trim() === '') {
    if (required) throw new ConfigError(`${label} is required in chain mode`);
    return undefined;
  }
  const normalized = normalizePrivateKey(raw);
  if (!KEY_PATTERN.test(normalized)) throw new ConfigError(`${label} is not a 32-byte hex key`);
  return deriveSigner(normalized, label);
}

function optionalKey(raw: string | undefined, label: string): SignerSpec | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  // A malformed optional owner key is ignored, never echoed; deployment-owner
  // matching below still decides whether another key may sign.
  const normalized = normalizePrivateKey(raw);
  if (!KEY_PATTERN.test(normalized)) {
    void label;
    return undefined;
  }
  try {
    return deriveSigner(normalized, label);
  } catch {
    void label;
    return undefined;
  }
}

export function modeFromEnv(env: NodeJS.ProcessEnv): ChainMode {
  const raw = (env.CHAIN_MODE ?? '').trim().toLowerCase();
  if (raw === '' || raw === 'demo' || raw === 'simulated' || raw === 'mock') return 'simulated';
  if (raw === 'chain' || raw === 'anvil' || raw === 'testnet') return 'chain';
  throw new ConfigError('CHAIN_MODE must be simulated, demo, anvil, testnet or chain');
}

/** Parse the environment; no value is logged or included in an error message. */
export function loadConfig(env: NodeJS.ProcessEnv): AgentConfig {
  const mode = modeFromEnv(env);
  const chainId = mode === 'chain'
    ? positiveInt(env.CHAIN_ID, 0)
    : positiveInt(env.CHAIN_ID, 31337);
  if (chainId === 0) throw new ConfigError('CHAIN_ID is required in chain mode');
  if (mode === 'chain' && MAINNET_CHAIN_IDS.has(chainId)) {
    throw new ConfigError(`chain ${chainId} is a mainnet; only testnets and anvil are allowed`);
  }
  const rpcUrl = env.RPC_URL?.trim() ?? '';
  if (mode === 'chain' && rpcUrl === '') throw new ConfigError('RPC_URL is required in chain mode');

  const rawMode = (env.CHAIN_MODE ?? '').trim().toLowerCase();
  if (mode === 'chain') {
    if (rawMode === 'anvil' && !localChain(chainId)) {
      throw new ConfigError('CHAIN_MODE=anvil requires a local chain id (31337 or 31338)');
    }
    if (rawMode === 'testnet' && localChain(chainId)) {
      throw new ConfigError('CHAIN_MODE=testnet requires a public testnet chain id; use CHAIN_MODE=anvil locally');
    }
  }

  const explorerBase = env.EXPLORER_BASE_URL?.trim() ?? '';
  if (explorerBase !== '' && !isHttpUrl(explorerBase)) {
    throw new ConfigError('EXPLORER_BASE_URL must start with http:// or https://');
  }

  const owner = optionalKey(env.DEMO_OWNER_PRIVATE_KEY, 'DEMO_OWNER_PRIVATE_KEY');
  const deployer = optionalKey(env.DEPLOYER_PRIVATE_KEY, 'DEPLOYER_PRIVATE_KEY');
  const executor = keySigner(env.EXECUTOR_PRIVATE_KEY, 'EXECUTOR_PRIVATE_KEY', false);

  const demoMode = mode === 'simulated'
    ? env.DEMO_MODE !== 'false'
    : env.ALLOW_DEMO_CONTROLS === 'true';
  const allowDemoControls = mode === 'simulated' || env.ALLOW_DEMO_CONTROLS === 'true';

  if (mode === 'chain' && allowDemoControls && !DEMO_CONTROL_CHAIN_IDS.has(chainId)) {
    throw new ConfigError(`demo controls are not allowed on chain ${chainId}`);
  }

  const chainLabel: AgentConfig['chainLabel'] = mode === 'simulated'
    ? 'SIMULATED'
    : rawMode === 'anvil'
      ? 'ANVIL'
      : rawMode === 'testnet'
        ? 'TESTNET'
        : localChain(chainId)
          ? 'ANVIL'
          : 'TESTNET';

  return {
    mode,
    chainLabel,
    chainId,
    rpcUrl: rpcUrl || 'http://127.0.0.1:8545',
    port: positiveInt(env.PORT, 8787),
    host: env.HOST?.trim() || '127.0.0.1',
    demoMode,
    allowDemoControls,
    ...(executor ? { executorSigner: executor } : {}),
    ...(owner ? { ownerSigner: owner } : {}),
    ...(deployer ? { deployerSigner: deployer } : {}),
    ...(isAddress(env.OWNER_ADDRESS) ? { ownerAddress: env.OWNER_ADDRESS } : {}),
    ...(isAddress(env.EXECUTOR_ADDRESS) ? { executorAddress: env.EXECUTOR_ADDRESS } : {}),
    ...(explorerBase ? { explorerBase } : {}),
    rateLimitCapacity: positiveInt(env.RATE_LIMIT_CAPACITY, 120),
    rateLimitRefillPerSecond: positiveNumber(env.RATE_LIMIT_REFILL_PER_SECOND, 2),
    runLimitCapacity: positiveInt(env.DEMO_MAX_RUNS_PER_HOUR, 20),
    runLimitRefillPerSecond: 1 / 3_600,
    trustProxy: env.TRUST_PROXY === 'true',
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter((value) => value !== ''),
    runCooldownMs: nonNegativeInt(env.DEMO_RUN_COOLDOWN_MS, 30_000),
    pauseCooldownMs: nonNegativeInt(env.DEMO_PAUSE_COOLDOWN_MS, 60_000),
    resetCooldownMs: nonNegativeInt(env.DEMO_RESET_COOLDOWN_MS, 120_000),
    minExecutorBalanceWei: mode === 'chain' ? nonNegativeBigint(env.MIN_EXECUTOR_BALANCE_WEI, 10n ** 16n) : 0n,
  } as AgentConfig;
}

export interface SignerSelection {
  ownerSigner?: Signer;
  executorSigner: Signer;
}

/** Public address only; never returns key material. */
export function signerAddress(signer: Signer): Address {
  return signer.kind === 'privateKey' ? signer.address : signer.value;
}

/** Used only to construct a signer; never log or return this value to a client. */
export function signerPrivateKey(signer: Signer | undefined): Hex | undefined {
  return signer?.kind === 'privateKey' ? signer.value : undefined;
}

function sameAddress(left: Address | undefined, right: Address | undefined): boolean {
  return left !== undefined && right !== undefined && left.toLowerCase() === right.toLowerCase();
}

/** Oracle writes must be signed by the on-chain admin, not merely a funded key. */
export function selectOracleAdminKey(config: AgentConfig, oracleAdmin: Address): SignerSpec {
  const candidate = [config.ownerSigner, config.deployerSigner, config.executorSigner].find(
    (signer): signer is SignerSpec =>
      signer?.kind === 'privateKey' && sameAddress(signer.address, oracleAdmin),
  );
  if (!candidate) throw new ConfigError('no configured private key matches the on-chain oracle admin');
  return candidate;
}

/**
 * Match configured signers to the deployment record. A key that belongs to a
 * different address is rejected rather than silently used.
 */
export function selectSigners(
  config: AgentConfig,
  deployment: { owner?: Address; executor?: Address },
): SignerSelection {
  const configuredExecutor = config.executorSigner;
  const executorAddress = configuredExecutor?.kind === 'privateKey' ? configuredExecutor.address : undefined;
  if (executorAddress && deployment.executor && !sameAddress(executorAddress, deployment.executor)) {
    throw new ConfigError('the configured executor key does not match the deployment executor');
  }

  let executor = configuredExecutor;
  if (!executor && deployment.executor) {
    if (!localChain(config.chainId)) {
      throw new ConfigError('EXECUTOR_PRIVATE_KEY is required outside anvil');
    }
    executor = { kind: 'address', value: deployment.executor };
  }
  if (!executor) throw new ConfigError('no executor signer for this deployment');

  const candidates = [config.ownerSigner, config.deployerSigner].filter(
    (candidate): candidate is SignerSpec =>
      candidate !== undefined && candidate.kind === 'privateKey',
  );
  let owner: Signer | undefined = candidates.find((candidate) =>
    sameAddress(candidate.address, deployment.owner),
  );
  if (!owner && config.ownerAddress && sameAddress(config.ownerAddress, deployment.owner)) {
    if (!localChain(config.chainId)) throw new ConfigError('an owner private key is required outside anvil');
    owner = { kind: 'address', value: config.ownerAddress };
  }
  if (!owner && candidates.length > 0) {
    throw new ConfigError('the configured owner key does not match the deployment owner');
  }

  return {
    ...(owner ? { ownerSigner: owner } : {}),
    executorSigner: executor,
  };
}

/** Load `.env` into the process without printing any value. Missing file is allowed. */
export function loadDotEnv(cwd = process.cwd()): void {
  const path = resolve(cwd, '.env');
  try {
    process.loadEnvFile(path);
  } catch (error) {
    // No .env is a valid configuration (tests and CI use explicit env vars).
    // A malformed .env is not: fail closed instead of silently running with
    // a partial environment.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
