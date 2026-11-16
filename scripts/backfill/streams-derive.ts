/**
 * Streams derived-state tooling (STREAMS_INFRA, D-306). Read-only RPC; never sends a transaction.
 *
 *   pnpm --silent --filter @vouch/scripts streams:verify                      # real chain: backfill == live(webhook) == replay == rebuild
 *   pnpm --silent --filter @vouch/scripts streams:verify --db-url <url>       # hosted: live hash(db) == replay(db raw rows) == chain backfill
 *   pnpm --silent --filter @vouch/scripts streams:backfill [--db-url <url>]   # chain → envelopes → ingest (default: memory, prints hash)
 *   pnpm --silent --filter @vouch/scripts streams:replay --db-url <url> [--in-place]   # raw stream_deliveries → derived
 *   pnpm --silent --filter @vouch/scripts streams:hash --db-url <url>
 *
 * Common flags: --from <block> (default Vouch v3 deploy block) · --to <block|head> (default head) · --batch <n>
 * (QuickNode-like batch size for the simulated live run, default 5) · --rpc <url> (default ARC_RPC_URL, then the public RPC).
 * --db-url: postgres://… (e.g. `railway run --service Postgres -- …` → DATABASE_PUBLIC_URL) or pglite://<dir> (stop the
 * api first: PGlite is single-process). Defaults to DATABASE_PUBLIC_URL only when --db is given. Credentials and the
 * RPC URL are never printed. `*.railway.internal` hosts are refused (not reachable from a laptop).
 */
import { VOUCH_ARC_TESTNET } from '@vouch/shared';
import { createDb, type DbHandle } from '../../apps/api/src/db/index';
import { chainEnvelopes, DEFAULT_RPC, getHead, getLogs, chunkRange, type RawLog } from '../../apps/api/src/streams/backfill';
import type { DerivedHash } from '../../apps/api/src/streams/hash';
import { createStreams } from '../../apps/api/src/streams/index';
import { backfillHash, maxDeliveredBatchEnd, replayHashFrom, runDeterminism } from '../../apps/api/src/streams/verify';
import { redactDbUrl } from '../streams/deliveries-db';

const [cmd = 'help', ...argv] = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const rpcUrl = opt('rpc') || process.env.ARC_RPC_URL || DEFAULT_RPC;
const rpcLabel = rpcUrl === DEFAULT_RPC ? DEFAULT_RPC : 'ARC_RPC_URL (redacted)';
const address = VOUCH_ARC_TESTNET.address;

function dbUrl(required: boolean): string | undefined {
  const u = opt('db-url') ?? (flag('db') ? process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL : undefined);
  if (!u && required) throw new Error('--db-url <postgres://…|pglite://dir> (or --db with DATABASE_PUBLIC_URL) is required');
  if (u && /\.railway\.internal/.test(u)) throw new Error('refusing a *.railway.internal host: use DATABASE_PUBLIC_URL (railway run --service Postgres)');
  return u;
}

async function openDb(url: string, migrate: boolean): Promise<DbHandle> {
  const h = createDb(url);
  if (migrate) await h.migrate();
  return h;
}

async function range(): Promise<{ from: number; to: number }> {
  const from = Number(opt('from') ?? VOUCH_ARC_TESTNET.deployBlock);
  const toArg = opt('to') ?? 'head';
  const to = toArg === 'head' ? await getHead({ rpcUrl }) : Number(toArg);
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) throw new Error(`bad range ${from}..${to}`);
  return { from, to };
}

async function fetchAll(from: number, to: number): Promise<RawLog[]> {
  const logs: RawLog[] = [];
  for (const [a, b] of chunkRange(from, to)) {
    const got = await getLogs({ rpcUrl }, address, a, b);
    console.error(`  eth_getLogs ${a}..${b} (${b - a + 1} blocks) → ${got.length} logs`);
    logs.push(...got);
  }
  return logs;
}

function printHash(label: string, h: DerivedHash) {
  const t = Object.entries(h.tables)
    .filter(([, v]) => v.rows > 0)
    .map(([k, v]) => `${k.replace(/^ev_/, '')}=${v.rows}`)
    .join(' ');
  console.log(`${label.padEnd(16)} ${h.hash}  (${t})`);
}

async function main() {
  switch (cmd) {
    case 'verify': {
      const url = dbUrl(false);
      if (!url) {
        const { from, to } = await range();
        console.log(`chain: Vouch v3 ${address} · blocks ${from}..${to} · rpc ${rpcLabel}`);
        const logs = await fetchAll(from, to);
        const r = await runDeterminism(logs, from, to, { batchSize: Number(opt('batch') ?? 5) });
        console.log(`live deliveries: ${r.deliveries} signed POSTs (each ${opt('batch') ?? 5}-block batch twice + 1 overlapping batch), statuses ${[...new Set(r.statuses)].join(',')}`);
        printHash('chain-backfill', r.backfill);
        printHash('live (webhook)', r.live);
        printHash('replay (copy)', r.replay);
        printHash('replay (wipe)', r.replayInPlace);
        printHash('rebuild', r.rebuild);
        console.log(r.equal ? 'OK: chain-backfill == live == replay == rebuild' : 'MISMATCH');
        process.exitCode = r.equal ? 0 : 1;
        return;
      }
      const db = await openDb(url, false);
      try {
        console.log(`db: ${redactDbUrl(url)}`);
        const streams = createStreams(db);
        const live = await streams.hash();
        const cur = await streams.cursor();
        const { hash: replay, deliveries } = await replayHashFrom(db);
        // Compare with the chain over exactly the blocks the Stream has delivered.
        const from = Number(opt('from') ?? VOUCH_ARC_TESTNET.deployBlock);
        const to = Number(opt('to') ?? (await maxDeliveredBatchEnd(db)) ?? cur.lastBlock ?? from);
        console.log(`deliveries: ${deliveries} · cursor block ${cur.lastBlock ?? '-'} · chain range ${from}..${to} · rpc ${rpcLabel}`);
        const chain = await backfillHash(await fetchAll(from, to), from, to);
        printHash('live (db)', live);
        printHash('replay (db raw)', replay);
        printHash('chain-backfill', chain);
        const ok = live.hash === replay.hash && replay.hash === chain.hash;
        console.log(ok ? 'OK: live == replay == chain-backfill' : 'MISMATCH');
        process.exitCode = ok ? 0 : 1;
      } finally {
        await db.close();
      }
      return;
    }
    case 'backfill': {
      const url = dbUrl(false) ?? 'pglite://memory';
      const { from, to } = await range();
      const db = await openDb(url, true);
      try {
        const streams = createStreams(db);
        console.log(`backfill ${from}..${to} → ${redactDbUrl(url)} · rpc ${rpcLabel}`);
        let n = 0;
        for await (const env of chainEnvelopes({
          rpcUrl,
          address,
          fromBlock: from,
          toBlock: to,
          batchSize: opt('batch') ? Number(opt('batch')) : undefined,
          onChunk: (c) => console.error(`  ${c.from}..${c.to}: ${c.logs} logs → ${c.envelopes} envelope(s)`),
        })) {
          const r = await streams.ingestEnvelope(env);
          n += r.newEvents;
        }
        console.log(`new events: ${n}`);
        printHash('derived', await streams.hash());
      } finally {
        await db.close();
      }
      return;
    }
    case 'replay': {
      const url = dbUrl(true)!;
      const db = await openDb(url, flag('in-place'));
      try {
        if (flag('in-place')) {
          const streams = createStreams(db);
          const before = await streams.hash();
          await streams.wipeAll();
          const done = await streams.ingestPending({ emit: false, source: 'replay' });
          const after = await streams.hash();
          printHash('before', before);
          printHash(`replayed (${done.length})`, after);
          console.log(before.hash === after.hash ? 'OK: identical after wipe + replay' : 'CHANGED (expected only if ingestion had been behind)');
        } else {
          const { hash, deliveries } = await replayHashFrom(db);
          printHash(`replay (${deliveries})`, hash);
        }
      } finally {
        await db.close();
      }
      return;
    }
    case 'hash': {
      const url = dbUrl(true)!;
      const db = await openDb(url, false);
      try {
        const h = await createStreams(db).hash();
        printHash('derived', h);
        for (const [k, v] of Object.entries(h.tables)) console.log(`  ${k.padEnd(16)} rows=${String(v.rows).padStart(4)} ${v.hash}`);
      } finally {
        await db.close();
      }
      return;
    }
    default:
      console.log('usage: streams-derive.ts verify|backfill|replay|hash [--db-url <url>|--db] [--from N] [--to N|head] [--batch N] [--rpc URL] [--in-place]');
  }
}

main().catch((err) => {
  console.error(`error: ${(err as Error).message}`);
  process.exitCode = 1;
});
