/**
 * Evidence generator. Hashes come from the running agent or from earlier evidence files; every
 * row of the generated Markdown is then read back from the chain.
 *
 *   evidence.ts collect  --manifest NAME --chain 31338 --api http://127.0.0.1:8798 --scenario S1 [--driver ui|api]
 *   evidence.ts add-tx   --manifest NAME --label L --kind K --hash 0x..          (kill switch, reset, deploy txs)
 *   evidence.ts import   --manifest NAME --legacy evidence/sepolia-ui-e2e-20261022.json
 *   evidence.ts generate --rpc URL [--manifest NAME ...] [--out docs/submission/EXECUTION-EVIDENCE.md]
 *
 * Manifests live in evidence/manifests/, generated receipts in evidence/receipts/. No key is read.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MANDATE_VAULT_ABI } from '@marginpilot/core';
import { createPublicClient, defineChain, http, toEventSelector, type Hex } from 'viem';
import { z } from 'zod';

import {
  ManifestSchema,
  renderEvidence,
  runFromApi,
  type Manifest,
  type ReceiptRecord,
  type ReceiptSet,
} from '../evidence/model.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const GENERATOR = 'apps/agent/src/cli/evidence.ts generate';

function args(argv: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag?.startsWith('--')) continue;
    map.set(flag.slice(2), [...(map.get(flag.slice(2)) ?? []), argv[i + 1] ?? '']);
    i += 1;
  }
  return map;
}
const one = (map: Map<string, string[]>, key: string, fallback?: string): string => {
  const value = map.get(key)?.[0] ?? fallback;
  if (value === undefined || value === '') throw new Error(`--${key} is required`);
  return value;
};
/** EVIDENCE_DIR redirects manifests and receipts (tests write to a temp dir, never to the tracked tree). */
const EVIDENCE_DIR = process.env.EVIDENCE_DIR ? resolve(process.env.EVIDENCE_DIR) : resolve(ROOT, 'evidence');
const manifestPath = (name: string) => resolve(EVIDENCE_DIR, 'manifests', `${name}.json`);
const receiptsPath = (name: string) => resolve(EVIDENCE_DIR, 'receipts', `${name}.json`);

async function loadManifest(name: string): Promise<Manifest | null> {
  try {
    return ManifestSchema.parse(JSON.parse(await readFile(manifestPath(name), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function saveManifest(manifest: Manifest): Promise<void> {
  await mkdir(dirname(manifestPath(manifest.name)), { recursive: true });
  await writeFile(manifestPath(manifest.name), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function deploymentFor(chainId: number) {
  const record = JSON.parse(await readFile(resolve(ROOT, 'deployments', `${chainId}.json`), 'utf8')) as {
    contracts: { vault: string }; explorerBase?: string;
  };
  return { vault: record.contracts.vault, explorerBase: record.explorerBase ?? '' };
}

async function ensureManifest(name: string, chainId: number): Promise<Manifest> {
  const existing = await loadManifest(name);
  if (existing) {
    if (existing.chainId !== chainId) throw new Error(`manifest ${name} is for chain ${existing.chainId}`);
    return existing;
  }
  const deployment = await deploymentFor(chainId);
  return ManifestSchema.parse({ name, chainId, vault: deployment.vault, explorerBase: deployment.explorerBase, entries: [], runs: [] });
}

function pushEntry(manifest: Manifest, entry: Manifest['entries'][number]): void {
  if (!manifest.entries.some((existing) => existing.txHash.toLowerCase() === entry.txHash.toLowerCase())) {
    manifest.entries.push(entry);
  }
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

async function collect(opts: Map<string, string[]>): Promise<void> {
  const chainId = Number(one(opts, 'chain'));
  const manifest = await ensureManifest(one(opts, 'manifest'), chainId);
  const api = one(opts, 'api').replace(/\/$/, '');
  const state = await getJson(`${api}/api/state`);
  const runId = z.object({ runId: z.string() }).parse(state).runId;
  const audit = await getJson(`${api}/api/audit?run=${encodeURIComponent(runId)}`);
  const driver = one(opts, 'driver', 'api') === 'ui' ? 'ui' : 'api';
  const run = runFromApi(state, audit, { scenario: one(opts, 'scenario'), driver });
  manifest.runs = [...manifest.runs.filter((existing) => existing.runId !== run.runId), run];
  if (run.mandateTx) pushEntry(manifest, { label: `mandate (${run.runId})`, kind: 'mandate', txHash: run.mandateTx, runId: run.runId });
  run.actionTxs.forEach((hash, index) => pushEntry(manifest, { label: `action ${index + 1} (${run.runId})`, kind: 'action', txHash: hash, runId: run.runId }));
  await saveManifest(manifest);
  console.log(`evidence: recorded ${run.runId} (${run.state}, llm ${run.llmMode}) in manifest ${manifest.name}`);
}

async function addTx(opts: Map<string, string[]>): Promise<void> {
  const manifest = await ensureManifest(one(opts, 'manifest'), Number(one(opts, 'chain')));
  pushEntry(manifest, ManifestSchema.shape.entries.element.parse({ label: one(opts, 'label'), kind: one(opts, 'kind', 'other'), txHash: one(opts, 'hash') }));
  await saveManifest(manifest);
  console.log(`evidence: added ${one(opts, 'label')} to manifest ${manifest.name}`);
}

async function importLegacy(opts: Map<string, string[]>): Promise<void> {
  const legacy = z
    .object({ chainId: z.number(), receipts: z.array(z.object({ label: z.string(), txHash: z.string() }).passthrough()) })
    .passthrough()
    .parse(JSON.parse(await readFile(resolve(ROOT, one(opts, 'legacy')), 'utf8')));
  const manifest = await ensureManifest(one(opts, 'manifest'), legacy.chainId);
  const kindOf = (label: string): Manifest['entries'][number]['kind'] =>
    /mandate/.test(label) ? 'mandate' : /repay|action/.test(label) ? 'action' : /shock/.test(label) ? 'shock' : /deploy/.test(label) ? 'deploy' : 'admin';
  for (const receipt of legacy.receipts) {
    pushEntry(manifest, { label: receipt.label, kind: kindOf(receipt.label), txHash: receipt.txHash });
  }
  await saveManifest(manifest);
  console.log(`evidence: imported ${legacy.receipts.length} hashes from ${one(opts, 'legacy')} (receipts are re-read on generate)`);
}

async function generate(opts: Map<string, string[]>): Promise<void> {
  const rpc = one(opts, 'rpc', process.env.RPC_URL);
  const wanted = opts.get('manifest');
  const names = wanted ?? (await readdir(resolve(EVIDENCE_DIR, 'manifests'))).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
  const sets: { manifest: Manifest; receipts: ReceiptSet }[] = [];
  for (const name of names) {
    const manifest = await loadManifest(name);
    if (!manifest) throw new Error(`manifest ${name} not found`);
    const client = createPublicClient({
      chain: defineChain({ id: manifest.chainId, name: `chain-${manifest.chainId}`, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } }),
      transport: http(rpc),
    });
    if ((await client.getChainId()) !== manifest.chainId) throw new Error(`RPC chain id does not match manifest ${name}`);
    const selector = toEventSelector('ActionExecuted(uint64,uint64,uint8,address,address,uint256,uint256,uint256)');
    const records: ReceiptRecord[] = [];
    for (const entry of manifest.entries) {
      const hash = entry.txHash as Hex;
      const receipt = await client.getTransactionReceipt({ hash });
      records.push({
        label: entry.label, kind: entry.kind, txHash: hash,
        status: receipt.status, blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(),
        from: receipt.from, to: receipt.to ?? null,
        actionExecutedEvents: receipt.logs.filter((log) => log.address.toLowerCase() === manifest.vault.toLowerCase() && log.topics[0] === selector).length,
      });
    }
    const vault = manifest.vault as Hex;
    const [paused, activeMandateId] = await Promise.all([
      client.readContract({ address: vault, abi: MANDATE_VAULT_ABI, functionName: 'paused' }) as Promise<boolean>,
      client.readContract({ address: vault, abi: MANDATE_VAULT_ABI, functionName: 'activeMandateId' }) as Promise<bigint>,
    ]);
    const receipts: ReceiptSet = {
      generator: GENERATOR, generatedAt: new Date().toISOString(), rpcHost: new URL(rpc).host,
      chainId: manifest.chainId, vault: manifest.vault, vaultState: { paused, activeMandateId: activeMandateId.toString() }, receipts: records,
    };
    await mkdir(dirname(receiptsPath(name)), { recursive: true });
    await writeFile(receiptsPath(name), `${JSON.stringify(receipts, null, 2)}\n`);
    sets.push({ manifest, receipts });
    console.log(`evidence: ${name}: ${records.length} receipts read (${records.filter((r) => r.status === 'success').length} success)`);
  }
  const out = resolve(ROOT, one(opts, 'out', 'docs/submission/EXECUTION-EVIDENCE.md'));
  await writeFile(out, renderEvidence(sets));
  console.log(`evidence: wrote ${out}`);
}

const [command, ...rest] = process.argv.slice(2);
const options = args(rest);
const commands: Record<string, (o: Map<string, string[]>) => Promise<void>> = { collect, 'add-tx': addTx, import: importLegacy, generate };
const run = command ? commands[command] : undefined;
if (!run) {
  console.error('usage: evidence.ts <collect|add-tx|import|generate> [--flag value ...]');
  process.exit(2);
}
await run(options).catch((error: unknown) => {
  console.error(`evidence: ${error instanceof Error ? error.message : 'failed'}`);
  process.exit(1);
});
