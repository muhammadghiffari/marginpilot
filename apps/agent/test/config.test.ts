import { describe, expect, test } from 'vitest';

import {
  ConfigError,
  loadConfig,
  modeFromEnv,
  selectSigners,
} from '../src/config.js';

const ANVIL_OWNER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ANVIL_EXECUTOR_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const ANVIL_OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const ANVIL_EXECUTOR = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const OTHER = '0x00000000000000000000000000000000000000e3';

describe('environment config', () => {
  test('defaults to the SIMULATED mode', () => {
    const config = loadConfig({});
    expect(config.mode).toBe('simulated');
    expect(config.chainId).toBe(31337);
    expect(config.port).toBe(8787);
    expect(config.demoMode).toBe(true);
  });

  test('parses mode aliases and rejects unknown modes', () => {
    expect(modeFromEnv({ CHAIN_MODE: 'anvil' })).toBe('chain');
    expect(modeFromEnv({ CHAIN_MODE: 'testnet' })).toBe('chain');
    expect(modeFromEnv({ CHAIN_MODE: 'demo' })).toBe('simulated');
    expect(() => modeFromEnv({ CHAIN_MODE: 'mainnet' })).toThrow(ConfigError);
  });

  test('chain mode requires RPC_URL and CHAIN_ID', () => {
    expect(() => loadConfig({ CHAIN_MODE: 'chain', CHAIN_ID: '31337' })).toThrow(/RPC_URL/);
    expect(() => loadConfig({ CHAIN_MODE: 'chain', RPC_URL: 'http://127.0.0.1:8545' })).toThrow(/CHAIN_ID/);
  });

  test('a malformed executor key fails closed without echoing it', () => {
    let message = '';
    try {
      loadConfig({ EXECUTOR_PRIVATE_KEY: 'not-a-key' });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('EXECUTOR_PRIVATE_KEY');
    expect(message).not.toContain('not-a-key');
  });

  test('rejects mainnet chain ids outright', () => {
    expect(() =>
      loadConfig({ CHAIN_MODE: 'chain', CHAIN_ID: '8453', RPC_URL: 'https://example.invalid' }),
    ).toThrow(/mainnet/);
  });

  test('refuses to mislabel a local chain as testnet (and vice versa)', () => {
    expect(() =>
      loadConfig({ CHAIN_MODE: 'testnet', CHAIN_ID: '31337', RPC_URL: 'http://127.0.0.1:8545' }),
    ).toThrow(/public testnet/);
    expect(() =>
      loadConfig({ CHAIN_MODE: 'anvil', CHAIN_ID: '84532', RPC_URL: 'https://example.invalid' }),
    ).toThrow(/local chain/);
  });

  test('labels a throwaway anvil chain correctly', () => {
    const config = loadConfig({
      CHAIN_MODE: 'chain',
      CHAIN_ID: '31338',
      RPC_URL: 'http://127.0.0.1:8547',
    });
    expect(config.chainLabel).toBe('ANVIL');
  });

  test('validates the explorer base URL', () => {
    expect(() =>
      loadConfig({
        CHAIN_MODE: 'chain',
        CHAIN_ID: '84532',
        RPC_URL: 'https://example.invalid',
        EXPLORER_BASE_URL: 'javascript:alert(1)',
      }),
    ).toThrow(/EXPLORER_BASE_URL/);
  });

  test('ALLOW_DEMO_CONTROLS is required for demo writes in chain mode', () => {
    const config = loadConfig({
      CHAIN_MODE: 'chain',
      CHAIN_ID: '84532',
      RPC_URL: 'https://example.invalid',
    });
    expect(config.demoMode).toBe(false);
    expect(config.allowDemoControls).toBe(false);
  });
});

describe('signer selection', () => {
  test('uses the deployer key as owner only when its address matches', () => {
    const config = loadConfig({
      CHAIN_MODE: 'chain',
      CHAIN_ID: '31337',
      RPC_URL: 'http://127.0.0.1:8545',
      DEMO_OWNER_PRIVATE_KEY: 'malformed',
      DEPLOYER_PRIVATE_KEY: ANVIL_OWNER_KEY,
      EXECUTOR_PRIVATE_KEY: ANVIL_EXECUTOR_KEY,
    });
    const selected = selectSigners(config, { owner: ANVIL_OWNER, executor: ANVIL_EXECUTOR });
    expect(selected.ownerSigner?.kind).toBe('privateKey');
    if (selected.ownerSigner?.kind === 'privateKey') expect(selected.ownerSigner.address).toBe(ANVIL_OWNER);
  });

  test('rejects a key that does not match the deployment owner', () => {
    const config = loadConfig({
      CHAIN_MODE: 'chain',
      CHAIN_ID: '31337',
      RPC_URL: 'http://127.0.0.1:8545',
      DEMO_OWNER_PRIVATE_KEY: ANVIL_OWNER_KEY,
      EXECUTOR_PRIVATE_KEY: ANVIL_EXECUTOR_KEY,
    });
    expect(() => selectSigners(config, { owner: OTHER, executor: ANVIL_EXECUTOR })).toThrow(/owner key/);
  });

  test('rejects an executor key that does not match the deployment executor', () => {
    const config = loadConfig({
      CHAIN_MODE: 'chain',
      CHAIN_ID: '31337',
      RPC_URL: 'http://127.0.0.1:8545',
      EXECUTOR_PRIVATE_KEY: ANVIL_EXECUTOR_KEY,
    });
    expect(() => selectSigners(config, { owner: ANVIL_OWNER, executor: OTHER })).toThrow(/executor key/);
  });

  test('allows an unlocked anvil address when no key is configured', () => {
    const config = loadConfig({
      CHAIN_MODE: 'chain',
      CHAIN_ID: '31337',
      RPC_URL: 'http://127.0.0.1:8545',
      OWNER_ADDRESS: ANVIL_OWNER,
    });
    const selected = selectSigners(config, { owner: ANVIL_OWNER, executor: ANVIL_EXECUTOR });
    expect(selected.ownerSigner).toEqual({ kind: 'address', value: ANVIL_OWNER });
    expect(selected.executorSigner).toEqual({ kind: 'address', value: ANVIL_EXECUTOR });
  });

  test('requires an executor key outside anvil', () => {
    const config = loadConfig({
      CHAIN_MODE: 'chain',
      CHAIN_ID: '84532',
      RPC_URL: 'https://example.invalid',
    });
    expect(() => selectSigners(config, { owner: ANVIL_OWNER, executor: ANVIL_EXECUTOR })).toThrow(
      /EXECUTOR_PRIVATE_KEY/,
    );
  });
});
