/**
 * Re-stamp every simulator oracle price at the current block time without
 * changing its value. `maxPriceAgeSec` (600s in the demo mandate) makes a
 * stale oracle halt the agent with StalePrice, which is correct but not a
 * useful live demo. Run before a presentation:
 *
 *   pnpm --filter @marginpilot/agent prices:refresh
 *
 * Reads `.env` from the repository root; never prints key material.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AddressSchema, MOCK_ORACLE_ABI, type Address } from '@marginpilot/core';
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { loadConfig, loadDotEnv, selectOracleAdminKey } from '../config.js';
import { loadTokenRegistry } from '../mandate/registry.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

async function main(): Promise<void> {
  loadDotEnv(ROOT);
  const config = loadConfig(process.env);
  if (config.mode !== 'chain') throw new Error('CHAIN_MODE must be anvil or testnet');

  const registry = await loadTokenRegistry(config.chainId, { root: ROOT });

  const chain = defineChain({
    id: config.chainId,
    name: `chain-${config.chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const remoteChainId = await publicClient.getChainId();
  if (remoteChainId !== config.chainId) {
    throw new Error(`RPC chain id ${remoteChainId} does not match CHAIN_ID ${config.chainId}`);
  }
  const oracleAdmin = AddressSchema.parse(await publicClient.readContract({
    address: registry.targets.oracle,
    abi: MOCK_ORACLE_ABI,
    functionName: 'admin',
  }));
  const account = privateKeyToAccount(selectOracleAdminKey(config, oracleAdmin).value);
  const wallet = createWalletClient({ account, chain, transport: http(config.rpcUrl) });

  const tokens: { symbol: string; address: Address }[] = [
    { symbol: 'mUSDC', address: registry.tokens.mUSDC },
    { symbol: 'mWETH', address: registry.tokens.mWETH },
    { symbol: 'mWSTETH', address: registry.tokens.mWSTETH },
  ];

  for (const token of tokens) {
    const [priceUsd8] = (await publicClient.readContract({
      address: registry.targets.oracle,
      abi: MOCK_ORACLE_ABI,
      functionName: 'getPrice',
      args: [token.address],
    })) as readonly [bigint, bigint];
    if (priceUsd8 === 0n) throw new Error(`oracle has no price for ${token.symbol}`);

    const hash = await wallet.writeContract({
      address: registry.targets.oracle,
      abi: MOCK_ORACLE_ABI,
      functionName: 'setPrice',
      args: [token.address, priceUsd8],
      account,
      chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`setPrice for ${token.symbol} reverted (${hash})`);
    console.log(`${token.symbol}: price ${priceUsd8.toString()} re-stamped in ${hash} (block ${receipt.blockNumber})`);
  }
  console.log(`oracle ${registry.targets.oracle} refreshed on chain ${config.chainId}`);
}

await main().catch((error: unknown) => {
  console.error(`refresh-prices: ${error instanceof Error ? error.message : 'failed'}`);
  process.exit(1);
});
