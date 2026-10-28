import { describe, expect, test } from 'vitest';

import { ManifestSchema, networkLabel, renderEvidence, runFromApi, type ReceiptSet } from '../src/evidence/model.js';

const H = (n: number) => `0x${n.toString(16).padStart(2, '0').repeat(32)}`;
const VAULT = '0x0000000000000000000000000000000000000abc';
// Synthetic inputs for unit tests only; real evidence is generated from RPC receipts.
const manifest = ManifestSchema.parse({
  name: 'unit', chainId: 11155111, vault: VAULT, explorerBase: 'https://sepolia.etherscan.io',
  entries: [{ label: 'mandate', kind: 'mandate', txHash: H(1) }],
  runs: [{
    runId: 'run-1', scenario: 'S1', state: 'COMPLETED', driver: 'ui', llmMode: 'live', llmModels: ['glm'],
    auditVerified: true, mandateTx: H(1), actionTxs: [H(2)], spentUsd8: '25016000000',
  }],
});
const receipts: ReceiptSet = {
  generator: 'unit', generatedAt: '2026-01-01T00:00:00.000Z', rpcHost: 'rpc.example', chainId: 11155111, vault: VAULT,
  vaultState: { paused: false, activeMandateId: '2' },
  receipts: [{ label: 'mandate', kind: 'mandate', txHash: H(1), status: 'success', blockNumber: '12', gasUsed: '34', from: VAULT, to: VAULT, actionExecutedEvents: 0 }],
};

describe('evidence model', () => {
  test('labels networks honestly', () => {
    expect(networkLabel(11155111)).toBe('REAL SEPOLIA');
    expect(networkLabel(31338)).toBe('LOCAL ANVIL');
  });

  test('derives a run from API responses and detects live vs scripted LLM', () => {
    const state = { runId: 'r', runState: 'COMPLETED', mandateTxHash: H(1), vault: { spentUsd8: '5' },
      ledger: [{ txHash: H(2), status: 'mined' }, { txHash: H(3), status: 'rejected' }] };
    const scripted = runFromApi(state, { verified: true, entries: [{ kind: 'llm.response', data: { model: 'scripted-local' } }] }, { scenario: 'S1', driver: 'api' });
    expect(scripted).toMatchObject({ llmMode: 'scripted', actionTxs: [H(2)], mandateTx: H(1) });
    const live = runFromApi(state, { verified: true, entries: [{ kind: 'llm.response', data: { model: 'zai-org/GLM-5.2' } }] }, { scenario: 'S1', driver: 'ui' });
    expect(live.llmMode).toBe('live');
    expect(live.llmModels).toEqual(['zai-org/GLM-5.2']);
  });

  test('renders hashes, labels, spend and the demo-only section; output is deterministic', () => {
    const md = renderEvidence([{ manifest, receipts }]);
    expect(md).toContain('REAL SEPOLIA');
    expect(md).toContain('https://sepolia.etherscan.io/tx/' + H(1));
    expect(md).toContain('$250.16');
    expect(md).toContain('live model');
    expect(md).toContain('Demo-only parts');
    expect(renderEvidence([{ manifest, receipts }])).toBe(md);
  });

  test('rejects a manifest with a malformed hash', () => {
    expect(() => ManifestSchema.parse({ ...manifest, entries: [{ label: 'x', kind: 'other', txHash: '0x12' }] })).toThrow();
  });
});
