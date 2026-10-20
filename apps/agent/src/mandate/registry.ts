import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AddressSchema } from '@marginpilot/core';
import { z } from 'zod';

export const TokenRegistrySchema = z
  .object({
    chainId: z.number().int().positive(),
    tokens: z
      .object({
        mUSDC: AddressSchema,
        mWETH: AddressSchema,
        mWSTETH: AddressSchema,
      })
      .strict(),
    targets: z
      .object({
        lending: AddressSchema,
        swap: AddressSchema,
      })
      .strict(),
  })
  .strict();

export type TokenRegistry = z.infer<typeof TokenRegistrySchema>;

const DeploymentFileSchema = z
  .object({
    chainId: z.number().int().positive(),
    contracts: z
      .object({
        mUSDC: AddressSchema,
        mWETH: AddressSchema,
        mWSTETH: AddressSchema,
        lending: AddressSchema,
        swap: AddressSchema,
      })
      .passthrough(),
  })
  .passthrough();

export class TokenRegistryMissingError extends Error {
  constructor(readonly path: string) {
    super(`deployments file not found: ${path}`);
    this.name = 'TokenRegistryMissingError';
  }
}

export class TokenRegistryInvalidError extends Error {
  constructor(
    readonly path: string,
    readonly detail: string,
  ) {
    super(`invalid deployments file ${path}: ${detail}`);
    this.name = 'TokenRegistryInvalidError';
  }
}

/**
 * SIMULATED test-only addresses. These mirror `packages/core/test/fixtures.ts`
 * and are never a deployment record. Production code must pass an explicit
 * deployment file; the fallback exists so B-07 tests can run before A-07.
 */
export const LOCAL_TEST_REGISTRY: TokenRegistry = {
  chainId: 31337,
  tokens: {
    mUSDC: '0x00000000000000000000000000000000000000a1',
    mWETH: '0x00000000000000000000000000000000000000a2',
    mWSTETH: '0x00000000000000000000000000000000000000a3',
  },
  targets: {
    lending: '0x00000000000000000000000000000000000000b1',
    swap: '0x00000000000000000000000000000000000000b3',
  },
};

export interface LoadTokenRegistryOptions {
  /** Repository root that contains `deployments/`. Defaults to cwd and its parents. */
  root?: string;
  /** Explicit test fallback. Never used silently unless supplied. */
  fallback?: TokenRegistry;
}

function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findDeployment(chainId: number, root?: string): Promise<string | null> {
  const candidates = root
    ? [join(root, 'deployments', `${chainId}.json`)]
    : [
        join(process.cwd(), 'deployments', `${chainId}.json`),
        join(process.cwd(), '..', '..', 'deployments', `${chainId}.json`),
        join(repoRoot(), 'deployments', `${chainId}.json`),
      ];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

/** Read a deployment record through a strict boundary; no key material is read. */
export async function loadTokenRegistry(
  chainId: number,
  options: LoadTokenRegistryOptions = {},
): Promise<TokenRegistry> {
  const path = await findDeployment(chainId, options.root);
  if (!path) {
    if (options.fallback) return options.fallback;
    throw new TokenRegistryMissingError(
      options.root
        ? join(options.root, 'deployments', `${chainId}.json`)
        : join('deployments', `${chainId}.json`),
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    throw new TokenRegistryInvalidError(path, error instanceof Error ? error.message : 'not valid JSON');
  }

  const parsed = DeploymentFileSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new TokenRegistryInvalidError(path, parsed.error.issues.map((issue) => issue.path.join('.')).join(', '));
  }
  if (parsed.data.chainId !== chainId) {
    throw new TokenRegistryInvalidError(path, `chainId ${parsed.data.chainId} does not match ${chainId}`);
  }

  return {
    chainId,
    tokens: {
      mUSDC: parsed.data.contracts.mUSDC,
      mWETH: parsed.data.contracts.mWETH,
      mWSTETH: parsed.data.contracts.mWSTETH,
    },
    targets: {
      lending: parsed.data.contracts.lending,
      swap: parsed.data.contracts.swap,
    },
  };
}
