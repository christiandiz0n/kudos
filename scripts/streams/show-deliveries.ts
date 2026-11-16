/**
 * Prints the webhook deliveries recorded by apps/api (POST /webhooks/streams).
 *
 *   pnpm --silent --filter @vouch/scripts streams:deliveries [--file <path>] [--last <n>] [--verified-only] [--body]
 *   pnpm --silent --filter @vouch/scripts streams:deliveries --db [--db-url <url>] [--last <n>] [--body]
 *
 * File mode (default): the local NDJSON spike log. Path: --file (relative to where you ran pnpm), else
 * STREAMS_SPIKE_LOG resolved against the repo root — the same rule apps/api uses — loaded from the root env file
 * like the api (QE-06). Holds accepted AND rejected requests.
 * DB mode (--db, D-305): the `stream_deliveries` table, VERIFIED deliveries only. URL: --db-url, else
 * DATABASE_PUBLIC_URL, else DATABASE_URL (process env wins over the root env file, so `railway run` works).
 * Hosted (Railway): `railway run --service Postgres -- pnpm --silent --filter @vouch/scripts streams:deliveries --db`
 * (needs the Postgres service's Public Networking / TCP proxy; see docs/deploy/RAILWAY.md).
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
import { readDbDeliveries, redactDbUrl, type DeliveryRec } from './deliveries-db';

const { values: opt } = parseArgs({
  options: {
    file: { type: 'string' },
    db: { type: 'boolean', default: false },
    'db-url': { type: 'string' },
    last: { type: 'string', default: '20' },
    'verified-only': { type: 'boolean', default: false },
    body: { type: 'boolean', default: false },
  },
});

const file = opt.file ? path.resolve(process.env.INIT_CWD ?? process.cwd(), opt.file) : spikeLogPath();

const knownTopics = new Map<string, string>(
  (helloAbi.filter((x) => x.type === 'event') as readonly AbiEvent[]).map((e) => [toEventSelector(e).toLowerCase(), e.name]),
);

type Rec = DeliveryRec;

let recs: Rec[];
if (opt.db || opt['db-url']) {
  const url = opt['db-url'] || process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('--db needs a database: pass --db-url, or set DATABASE_PUBLIC_URL / DATABASE_URL (e.g. via `railway run`)');
    process.exit(2);
  }
  if (/\.railway\.internal\b/.test(url)) {
    console.error(
      `${redactDbUrl(url)} is Railway's PRIVATE host (reachable only inside Railway). Enable Public Networking on the Postgres ` +
        'service and use its DATABASE_PUBLIC_URL (`railway run --service Postgres -- …`). See docs/deploy/RAILWAY.md.',
    );
    process.exit(2);
  }
  const { total, recs: rows } = await readDbDeliveries(url, { last: Number(opt.last), verifiedOnly: opt['verified-only'] });
  recs = rows;
  console.log(`${redactDbUrl(url)} stream_deliveries: ${total} row(s) (verified only), showing ${recs.length}`);
} else {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    console.log(`no deliveries yet (${file} does not exist)`);
    process.exit(0);
  }

  recs = text
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
}

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
  console.log(`\n${r.receivedAt ?? '?'}  ${verdict}  bytes=${r.bytes ?? '?'}${r.gzip ? ' (gzip)' : ''}${r.rowId !== undefined ? `  row=${r.rowId}` : ''}`);
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
