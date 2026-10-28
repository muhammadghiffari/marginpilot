import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, test } from 'vitest';

import { ViemChainPort } from '../src/chain/viem-port.js';

const A = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as const;
let server: Server | undefined;
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

/** Regression: viem caches eth_blockNumber for the polling interval (4 s by default), so a
 * snapshot taken right after a mined write was pinned to the block BEFORE it and the agent
 * halted with "mandate N does not match the active mandate N-1" on fast chains (anvil). */
describe('ViemChainPort snapshots', () => {
  test('ask the node for the head block on every attempt (no cached block number)', async () => {
    let blockNumberCalls = 0;
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        const rpc = JSON.parse(body) as { id: number; method: string };
        res.setHeader('content-type', 'application/json');
        if (rpc.method === 'eth_blockNumber') {
          blockNumberCalls += 1;
          res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: `0x${(100 + blockNumberCalls).toString(16)}` }));
        } else {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message: 'unavailable' } }));
        }
      });
    });
    await new Promise<void>((ready) => server!.listen(0, '127.0.0.1', ready));
    const port = new ViemChainPort({
      chainId: 31338,
      rpcUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      vault: A(1), oracle: A(2), lending: A(3), swap: A(4), owner: A(5), executor: A(6),
      tokens: [A(7)], tokenDecimals: { [A(7)]: 6 }, reserveToken: A(7),
      executorSigner: { kind: 'address', value: A(6) },
    });
    await expect(port.getVault()).rejects.toThrow();
    expect(blockNumberCalls).toBeGreaterThanOrEqual(2);
  }, 20_000);
});
