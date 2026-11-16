import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { REPO_ROOT } from '../env';

/**
 * Chain backfill → Streams-identical envelopes (D-306).
 *
 * eth_getLogs over [from, to] in ≤ 10,000-block chunks (Arc limit, INTERFACES §1), then each batch is passed through
 * the FROZEN production filter `docs/streams/filter-vouch.js` (the exact file pasted into the QuickNode dashboard),
 * executed in a bare `vm` context like QuickNode's sandbox. The filter's return value IS the envelope v1 body that a
 * live delivery carries, so the backfill feeds the same `decodeDelivery` + ingest path with the same bytes-level shape.
 * Read-only RPC only.
 */

export const PROD_FILTER_PATH = path.join(REPO_ROOT, 'docs/streams/filter-vouch.js');
export const MAX_LOG_RANGE = 10_000;
export const DEFAULT_RPC = 'https://rpc.testnet.arc.io';

export type RawLog = Record<string, unknown> & { topics: unknown[]; blockNumber: string | number };
export type FilterMain = (stream: unknown) => unknown;

/** Load a QuickNode filter file and return its `main` (no require/import/fs inside, like the dashboard sandbox). */
export function loadFilter(file = PROD_FILTER_PATH): FilterMain {
  const code = readFileSync(file, 'utf8');
  const ctx = vm.createContext({});
  vm.runInContext(`${code}\n;globalThis.__main = main;`, ctx, { filename: path.basename(file) });
  const main = (ctx as { __main?: FilterMain }).__main;
  if (typeof main !== 'function') throw new Error(`${file}: no main(stream)`);
  // Round-trip through JSON: a webhook body is JSON, so the envelope must be exactly what JSON.parse would give.
  return (stream) => {
    const out = main(JSON.parse(JSON.stringify(stream)));
    return out === null || out === undefined ? null : JSON.parse(JSON.stringify(out));
  };
}

const num = (v: string | number) => (typeof v === 'number' ? v : Number.parseInt(v, 16));
const hex = (n: number) => `0x${n.toString(16)}`;

interface RpcOpts {
  rpcUrl: string;
  fetchImpl?: typeof fetch;
  retries?: number;
}

async function rpc<T>(o: RpcOpts, method: string, params: unknown[]): Promise<T> {
  const f = o.fetchImpl ?? fetch;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= (o.retries ?? 3); attempt++) {
    try {
      const res = await f(o.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
      const j = (await res.json()) as { result?: T; error?: { code: number; message: string } };
      if (j.error) throw new Error(`${method}: ${j.error.code} ${j.error.message}`);
      return j.result as T;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  throw lastErr;
}

export async function getHead(o: RpcOpts): Promise<number> {
  return num(await rpc<string>(o, 'eth_blockNumber', []));
}

/** Inclusive [from, to] split into ranges of ≤ MAX_LOG_RANGE blocks. */
export function chunkRange(from: number, to: number, size = MAX_LOG_RANGE): Array<[number, number]> {
  if (size < 1 || size > MAX_LOG_RANGE) throw new Error(`chunk size must be 1..${MAX_LOG_RANGE}`);
  const out: Array<[number, number]> = [];
  for (let s = from; s <= to; s += size) out.push([s, Math.min(s + size - 1, to)]);
  return out;
}

/** eth_getLogs for `address` over one ≤10k range (raw RPC objects, hex fields — the same shape the `logs` dataset carries). */
export async function getLogs(o: RpcOpts, address: string, from: number, to: number): Promise<RawLog[]> {
  if (to - from > MAX_LOG_RANGE - 1) throw new Error('eth_getLogs range > 10,000 blocks');
  return rpc<RawLog[]>(o, 'eth_getLogs', [{ address, fromBlock: hex(from), toBlock: hex(to) }]);
}

export interface EnvelopeOpts {
  filter: FilterMain;
  streamId?: string;
  /** QuickNode-like batch size in blocks; default = the whole [start, end] range as one batch. */
  batchSize?: number;
}

/**
 * Wrap raw logs for [start, end] as QuickNode `logs` dataset input ({data: [block][log], metadata}) per batch and run
 * the filter. Returns the non-null filter outputs (envelope v1 bodies), in block order.
 */
export function buildEnvelopes(logs: RawLog[], start: number, end: number, opts: EnvelopeOpts): unknown[] {
  const size = opts.batchSize ?? end - start + 1;
  const byBlock = new Map<number, RawLog[]>();
  for (const l of logs) {
    const bn = num(l.blockNumber);
    if (!byBlock.has(bn)) byBlock.set(bn, []);
    byBlock.get(bn)!.push(l);
  }
  const out: unknown[] = [];
  for (let s = start; s <= end; s += size) {
    const e = Math.min(s + size - 1, end);
    const blocks = [...byBlock.keys()].filter((b) => b >= s && b <= e).sort((a, b) => a - b);
    if (blocks.length === 0) continue; // the filter would return null: QuickNode sends nothing
    const env = opts.filter({
      data: blocks.map((b) => byBlock.get(b)!),
      metadata: { stream_id: opts.streamId ?? 'backfill', network: 'arc-testnet', dataset: 'logs', batch_start_range: s, batch_end_range: e },
    });
    if (env !== null) out.push(env);
  }
  return out;
}

export interface ChainBackfillOpts extends RpcOpts {
  address: string;
  fromBlock: number;
  toBlock: number;
  filter?: FilterMain;
  chunkSize?: number;
  batchSize?: number;
  onChunk?: (info: { from: number; to: number; logs: number; envelopes: number }) => void;
}

/** Fetch [from, to] and yield envelopes chunk by chunk (memory stays bounded by one 10k-block chunk). */
export async function* chainEnvelopes(o: ChainBackfillOpts): AsyncGenerator<unknown> {
  const filter = o.filter ?? loadFilter();
  for (const [from, to] of chunkRange(o.fromBlock, o.toBlock, o.chunkSize)) {
    const logs = await getLogs(o, o.address, from, to);
    const envs = buildEnvelopes(logs, from, to, { filter, batchSize: o.batchSize });
    o.onChunk?.({ from, to, logs: logs.length, envelopes: envs.length });
    for (const env of envs) yield env;
  }
}
