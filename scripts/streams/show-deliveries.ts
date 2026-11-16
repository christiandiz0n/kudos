/**
 * Prints the S3 webhook deliveries recorded by apps/api (POST /webhooks/streams) in the NDJSON spike log.
 *
 *   pnpm --silent --filter @vouch/scripts streams:deliveries [--file <path>] [--last <n>] [--verified-only] [--body]
 *
 * Log path: --file (relative to where you ran pnpm), else STREAMS_SPIKE_LOG resolved against the repo root —
 * the same rule apps/api uses — loaded from the root env file like the api (QE-06).
 *
 * Per delivery: time, HTTP status + verified flag (+ reject reason), QuickNode batch headers, payload shape,
 * log count, block range, event names, tx hashes. Event names are shown ONLY for verified deliveries
 * (an unverified body is sender-controlled, so its labels/tx hashes are not evidence — QE-07); for those,
 * names come from the filter's `event` field, falling back to topic0 → Hello ABI.
 * Contains no secrets (the log holds request headers + body only).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { toEventSelector, type AbiEvent } from 'viem';
import { helloAbi } from '@vouch/shared';
import { spikeLogPath } from './lib';

const { values: opt } = parseArgs({
  options: {
    file: { type: 'string' },
    last: { type: 'string', default: '20' },
    'verified-only': { type: 'boolean', default: false },
    body: { type: 'boolean', default: false },
  },
});

const file = opt.file ? path.resolve(process.env.INIT_CWD ?? process.cwd(), opt.file) : spikeLogPath();

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
  text = await readFile(file, 'utf8');
} catch {
  console.log(`no deliveries yet (${file} does not exist)`);
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
if (opt['verified-only']) recs = recs.filter((r) => r.verified === true);
recs = recs.slice(-Number(opt.last));
console.log(`${file}: ${total} line(s), showing ${recs.length}${opt['verified-only'] ? ' verified' : ''}`);

for (const r of recs) {
  const h = r.headers ?? {};
  const s = r.summary;
  const trusted = r.verified === true;
  const verdict =
    r.verified === undefined
      ? 'UNVERIFIED (pre-HMAC record) — body unauthenticated, labels untrusted'
      : trusted
        ? 'VERIFIED'
        : `REJECTED (${r.status ?? '?'} ${r.reason ?? ''}) — unverified body, labels untrusted`;
  console.log(`\n${r.receivedAt ?? '?'}  ${verdict}  bytes=${r.bytes ?? '?'}${r.gzip ? ' (gzip)' : ''}`);
  console.log(
    `  qn: stream=${h['stream-id'] ?? '-'} batch=${h['batch-start-range'] ?? (trusted ? s?.batch?.start : null) ?? '-'}..${h['batch-end-range'] ?? (trusted ? s?.batch?.end : null) ?? '-'}` +
      ` ts=${h['x-qn-timestamp'] ?? '-'}${r.timestamp?.skewSec != null ? ` (skew ${r.timestamp.skewSec}s, unit ${r.timestamp.unit})` : ''}`,
  );
  if (!trusted) {
    console.log(`  (summary withheld: body not authenticated${opt.body ? '' : '; --body shows it raw'})`);
  } else if (s) {
    const names = s.eventNames?.length ? s.eventNames : (s.topic0s ?? []).map((t) => knownTopics.get(t) ?? t.slice(0, 10) + '…');
    console.log(`  shape=${s.shape} logs=${s.logCount} blocks=${s.blockRange ? `${s.blockRange.from}..${s.blockRange.to}` : '-'} events=${names.join(',') || '-'}`);
    for (const tx of s.txHashes) console.log(`  tx ${tx}`);
  } else console.log('  (body not JSON or empty)');
  if (opt.body && r.body) {
    const b = r.body.length > 4000 ? r.body.slice(0, 4000) + '…' : r.body;
    console.log(`  body${trusted ? '' : ' (UNTRUSTED)'}: ${b}`);
  }
}
