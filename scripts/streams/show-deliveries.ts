/**
 * Prints the S3 webhook deliveries recorded by apps/api (POST /webhooks/streams) in the NDJSON spike log.
 *
 *   pnpm --filter @vouch/scripts streams:deliveries [--file <path>] [--last <n>] [--verified-only] [--body]
 *
 * Per delivery: time, HTTP status + verified flag (+ reject reason), QuickNode batch headers, payload shape,
 * log count, block range, event names (from the filter envelope, else topic0 → Hello ABI), tx hashes.
 * Contains no secrets (the log holds request headers + body only).
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { toEventSelector, type AbiEvent } from 'viem';
import { helloAbi } from '@vouch/shared';
import { DEFAULT_NDJSON } from './lib';

const { values: opt } = parseArgs({
  options: {
    file: { type: 'string', default: process.env.STREAMS_SPIKE_LOG ?? DEFAULT_NDJSON },
    last: { type: 'string', default: '20' },
    'verified-only': { type: 'boolean', default: false },
    body: { type: 'boolean', default: false },
  },
});

const knownTopics = new Map<string, string>(
  (helloAbi.filter((x) => x.type === 'event') as readonly AbiEvent[]).map((e) => [toEventSelector(e).toLowerCase(), e.name]),
);

interface Rec {
  receivedAt?: string;
  verified?: boolean;
  status?: number;
  reason?: string;
  headers?: Record<string, string>;
  bytes?: number;
  gzip?: boolean;
  timestamp?: { unit: string; skewSec: number | null } | null;
  body?: string;
  summary?: {
    logCount: number;
    blockRange: { from: number; to: number } | null;
    txHashes: string[];
    topic0s: string[];
    eventNames: string[];
    batch: { start: number | null; end: number | null } | null;
    shape: string;
  } | null;
}

let text: string;
try {
  text = await readFile(opt.file!, 'utf8');
} catch {
  console.log(`no deliveries yet (${opt.file} does not exist)`);
  process.exit(0);
}

let recs: Rec[] = text
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => {
    try {
      return JSON.parse(l) as Rec;
    } catch {
      return { reason: 'unparseable NDJSON line' } as Rec;
    }
  });
const total = recs.length;
if (opt['verified-only']) recs = recs.filter((r) => r.verified);
recs = recs.slice(-Number(opt.last));
console.log(`${opt.file}: ${total} line(s), showing ${recs.length}${opt['verified-only'] ? ' verified' : ''}`);

for (const r of recs) {
  const h = r.headers ?? {};
  const s = r.summary;
  const verified =
    r.verified === undefined ? 'n/a (pre-HMAC record)' : r.verified ? 'VERIFIED' : `REJECTED ${r.status} ${r.reason ?? ''}`;
  const names = s?.eventNames?.length ? s.eventNames : (s?.topic0s ?? []).map((t) => knownTopics.get(t) ?? t.slice(0, 10) + '…');
  console.log(`\n${r.receivedAt ?? '?'}  ${verified}  bytes=${r.bytes ?? '?'}${r.gzip ? ' (gzip)' : ''}`);
  console.log(
    `  qn: stream=${h['stream-id'] ?? '-'} batch=${h['batch-start-range'] ?? s?.batch?.start ?? '-'}..${h['batch-end-range'] ?? s?.batch?.end ?? '-'}` +
      ` ts=${h['x-qn-timestamp'] ?? '-'}${r.timestamp?.skewSec != null ? ` (skew ${r.timestamp.skewSec}s, unit ${r.timestamp.unit})` : ''}`,
  );
  if (s) {
    console.log(`  shape=${s.shape} logs=${s.logCount} blocks=${s.blockRange ? `${s.blockRange.from}..${s.blockRange.to}` : '-'} events=${names.join(',') || '-'}`);
    for (const tx of s.txHashes) console.log(`  tx ${tx}`);
  } else console.log('  (body not JSON or empty)');
  if (opt.body && r.body) console.log(`  body: ${r.body.length > 4000 ? r.body.slice(0, 4000) + '…' : r.body}`);
}
