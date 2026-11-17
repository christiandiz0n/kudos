import { createHmac, timingSafeEqual } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildDeliveryRow, type NewDelivery } from '../streams/deliveries';
import { createRateLimiter, type RateLimitOpts } from '../streams/rate-limit';

/**
 * POST /webhooks/streams — QuickNode Streams webhook (Phase 0 / S3 spike).
 *
 * Signature (QuickNode guide "Validating incoming Streams webhook messages" + its reference server
 * github.com/quiknode-labs/streams-webhook-validate-signature, re-checked 2026-11-16):
 *   headers  X-QN-Nonce, X-QN-Timestamp, X-QN-Signature
 *   X-QN-Signature = hex( HMAC-SHA256( key = utf8(security_token), msg = nonce + timestamp + payload ) )
 *   payload = the DECODED (un-gzipped) body. Fastify does not inflate request bodies, so we gunzip here
 *   when Content-Encoding is gzip (or the bytes start with the gzip magic).
 *
 * Behaviour (order matters: the cheap checks run BEFORE any decompression or parsing, D-308):
 *   - STREAMS_WEBHOOK_SECRET unset/placeholder → 503 (fail closed). Nothing is decoded.
 *   - any of X-QN-Nonce / X-QN-Timestamp / X-QN-Signature missing → 401. Nothing is decoded.
 *   - raw body > RAW_BODY_LIMIT → 413 from Fastify's parser (before this handler runs).
 *   - gunzip output > MAX_DECODED_BYTES → 413 `decoded-body-too-large` (zlib maxOutputLength: inflation stops at the
 *     cap, so a gzip bomb costs at most MAX_DECODED_BYTES of memory). Other gzip errors → 400 `body-decode-failed`.
 *   - bad signature → 401. JSON is parsed only AFTER the HMAC verifies (unverified bodies are never parsed).
 *   - verified → 200 quickly (deliveries are sequential; QuickNode waits for our 2xx).
 *   - X-QN-Timestamp skew is only logged (unit is UNVERIFIED: the guide's sample shows 10-digit seconds).
 *   - verified → one row in `stream_deliveries` (D-305) BEFORE the 200; if that insert fails → 500 so QuickNode
 *     retries (no ack without persistence). Rejected requests (401/503/400) never get a row.
 * Every request also emits one structured log line (`streams delivery`: verified, status, streamId, batch range,
 * event count/names, row id; never the token, signature or body), visible in `railway logs`.
 * Local dev: every request (accepted or not) is also appended to the NDJSON spike log, unless disabled (null).
 * Nothing secret is written: the request headers carry no secret (the signature is a MAC, not the token).
 */

export interface WebhookRouteOpts {
  /** NDJSON spike log; null disables it (default on hosts, see env.resolveSpikeLog). */
  logFile: string | null;
  /** Persists a VERIFIED delivery; resolves with the row id. Omitted → nothing is stored (tests of pure HMAC logic). */
  store?: (row: NewDelivery) => Promise<{ id: number; duplicate?: boolean }>;
  /**
   * Phase 2 (D-306): decode + ingest a delivery AFTER its raw row committed. A failure here is logged and recorded by
   * the ingester (ev_ingest_log) and retried from the raw table; the response stays 200 because the delivery is durable.
   */
  ingest?: (rowId: number, body: unknown) => Promise<IngestSummary>;
  /** QuickNode stream security token. Undefined → every delivery is answered 503. */
  secret: string | undefined;
  /** Log a warning when |now - X-QN-Timestamp| exceeds this (seconds). Never rejects. Default 300. */
  maxSkewSec?: number;
  /** Per-IP token bucket (SEC-2-10a, D-309). false disables it. Default: burst 600, 50 req/s. */
  rateLimit?: RateLimitOpts | false;
  /**
   * Max time the request waits for ingest (SEC-2-10c). On timeout the response is still 200 (the raw row is durable)
   * and the ingest keeps running in the background (serialized). Default INGEST_WAIT_MS.
   */
  ingestWaitMs?: number;
  /** Raw (as received) body limit in bytes. Default RAW_BODY_LIMIT. Tests only. */
  bodyLimit?: number;
  /** Max gunzip output in bytes. Default MAX_DECODED_BYTES. Tests only. */
  maxDecodedBytes?: number;
}

/**
 * Size limits (D-308), sized from real deliveries:
 *   - Our filter only forwards Vouch logs. One envelope event is ~0.9 KB of JSON: the stored delivery for blocks
 *     72606070..72606074 (8 events) is 7,325 bytes, and the ENTIRE v3 history (48 events, 72605845..72612484) as one
 *     envelope is ~44 KB. The Hello S3 evidence deliveries were 758 bytes. The Stream is configured with compression
 *     "none" (D-307), so real deliveries arrive uncompressed.
 *   - 4 MiB raw ≈ 4,500 Vouch events ≈ 650 canonical pay txs in ONE batch: about 100× our whole history to date, and far
 *     beyond any demo burst. It keeps the per-request allocation small (was 50 MiB).
 *   - 8 MiB decoded = 2× the raw limit, so any body we would accept uncompressed is also accepted gzipped (in case
 *     QuickNode compression is ever turned on), and a bomb inflates to at most 8 MiB instead of GBs.
 *   - Over-limit requests can't be authenticated (the HMAC covers the decoded bytes), so they are rejected like other
 *     unauthenticated requests: logged, no stream_deliveries row (D-305), never 500 (no QuickNode retry loop).
 */
export const RAW_BODY_LIMIT = 4 * 1024 * 1024;
/** 5 s: well under QuickNode's 15 s post timeout (D-303), far above a normal ingest (milliseconds). */
export const INGEST_WAIT_MS = 5_000;
export const MAX_DECODED_BYTES = 8 * 1024 * 1024;
/** NDJSON spike log (local dev only) keeps rejected bodies only up to this size. */
const SPIKE_LOG_BODY_MAX = 64 * 1024;

/** gunzip output exceeded the cap (zlib ERR_BUFFER_TOO_LARGE). */
export class DecodedBodyTooLarge extends Error {
  constructor(readonly limit: number) {
    super(`decoded body exceeds ${limit} bytes`);
  }
}

/** Test hook: how many times the route has started a gunzip (asserts that rejected requests are never inflated). */
export const decodeStats = { gunzipCalls: 0 };

/** What the ingest hook reports for the `streams delivery` log line. */
export interface IngestSummary {
  newEvents: number;
  duplicates: number;
  ignored: number;
  rebuilt: boolean;
  cursor: { lastBlock: number | null; lastLogIndex: number | null; events: number };
}

const SIG_HEX = /^[0-9a-f]{64}$/i;

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function isGzip(raw: Buffer, contentEncoding: string | undefined): boolean {
  const gzipMagic = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b;
  return /gzip/i.test(contentEncoding ?? '') || gzipMagic;
}

/**
 * Body bytes the HMAC is computed over: gunzipped if the delivery is gzip-compressed, never more than
 * `maxOutputLength` bytes (throws DecodedBodyTooLarge; zlib stops inflating at the cap).
 */
export function decodeBody(raw: Buffer, contentEncoding: string | undefined, maxOutputLength = MAX_DECODED_BYTES): { body: Buffer; gzip: boolean } {
  const gzip = isGzip(raw, contentEncoding);
  if (!gzip) {
    if (raw.length > maxOutputLength) throw new DecodedBodyTooLarge(maxOutputLength);
    return { body: raw, gzip };
  }
  decodeStats.gunzipCalls++;
  try {
    return { body: gunzipSync(raw, { maxOutputLength }), gzip };
  } catch (err) {
    if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError) throw new DecodedBodyTooLarge(maxOutputLength);
    throw err;
  }
}

export function computeSignature(secret: string, nonce: string, timestamp: string, body: Buffer): string {
  return createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(Buffer.from(nonce, 'utf8'))
    .update(Buffer.from(timestamp, 'utf8'))
    .update(body)
    .digest('hex');
}

/** Constant-time comparison of a hex signature header against the expected HMAC. */
export function signatureMatches(expectedHex: string, givenHex: string): boolean {
  if (!SIG_HEX.test(givenHex)) return false;
  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(givenHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Interprets X-QN-Timestamp as seconds (≤ 11 digits) or milliseconds (≥ 12 digits). */
export function timestampSkew(ts: string, nowMs = Date.now()): { unit: 's' | 'ms' | 'unknown'; skewSec: number | null } {
  if (!/^\d+$/.test(ts)) return { unit: 'unknown', skewSec: null };
  const n = Number(ts);
  const unit = ts.length >= 12 ? 'ms' : 's';
  const ms = unit === 'ms' ? n : n * 1000;
  return { unit, skewSec: Math.round((nowMs - ms) / 1000) };
}

export interface DeliverySummary {
  /** Number of log objects found anywhere in the payload (raw dataset logs or our filter's `events`). */
  logCount: number;
  blockRange: { from: number; to: number } | null;
  txHashes: string[];
  topic0s: string[];
  /** `event` names attached by infra/streams/filter-logs.js (empty for unfiltered payloads). */
  eventNames: string[];
  /** Batch range from our filter envelope or `metadata` (when present in the body). */
  batch: { start: number | null; end: number | null } | null;
  /** Shape hint, e.g. "envelope:v1", "data:array[3]", "array[5]". */
  shape: string;
}

const toNum = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.length > 0) {
    const n = v.startsWith('0x') ? Number.parseInt(v, 16) : Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

type LogLike = { topics: unknown[]; [k: string]: unknown };

/** Defensive walk: logs may be nested [block][receipt][log], [block][log], or inside objects. */
export function collectLogs(node: unknown, out: LogLike[] = [], depth = 0): LogLike[] {
  if (depth > 8 || node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const x of node) collectLogs(x, out, depth + 1);
    return out;
  }
  const o = node as Record<string, unknown>;
  if (Array.isArray(o.topics)) {
    out.push(o as LogLike);
    return out;
  }
  for (const k of ['events', 'data', 'logs', 'receipts', 'result']) {
    if (k in o) collectLogs(o[k], out, depth + 1);
  }
  return out;
}

export function summarize(payload: unknown): DeliverySummary {
  const logs = collectLogs(payload);
  const blocks: number[] = [];
  const tx = new Set<string>();
  const t0 = new Set<string>();
  const names = new Set<string>();
  for (const l of logs) {
    const b = toNum(l.blockNumber);
    if (b !== null) blocks.push(b);
    const h = l.transactionHash ?? l.txHash;
    if (typeof h === 'string') tx.add(h.toLowerCase());
    const first = l.topics[0];
    if (typeof first === 'string') t0.add(first.toLowerCase());
    if (typeof l.event === 'string') names.add(l.event);
  }
  const o = (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) as Record<string, unknown>;
  const meta = (o.metadata && typeof o.metadata === 'object' ? o.metadata : {}) as Record<string, unknown>;
  const bStart = toNum(o.batchStart ?? meta.batch_start_range);
  const bEnd = toNum(o.batchEnd ?? meta.batch_end_range);
  const shape = Array.isArray(payload)
    ? `array[${payload.length}]`
    : 'v' in o && Array.isArray(o.events)
      ? `envelope:v${String(o.v)}`
      : Array.isArray(o.data)
        ? `data:array[${o.data.length}]`
        : typeof payload;
  return {
    logCount: logs.length,
    blockRange: blocks.length ? { from: Math.min(...blocks), to: Math.max(...blocks) } : null,
    txHashes: [...tx],
    topic0s: [...t0],
    eventNames: [...names],
    batch: bStart !== null || bEnd !== null ? { start: bStart, end: bEnd } : null,
    shape,
  };
}

export async function webhookRoutes(app: FastifyInstance, opts: WebhookRouteOpts) {
  const maxSkewSec = opts.maxSkewSec ?? 300;
  const bodyLimit = opts.bodyLimit ?? RAW_BODY_LIMIT;
  const maxDecoded = opts.maxDecodedBytes ?? MAX_DECODED_BYTES;
  const ingestWaitMs = opts.ingestWaitMs ?? INGEST_WAIT_MS;

  // SEC-2-10a: refuse floods before the body is read or anything is decoded. Scoped to this plugin (encapsulated).
  if (opts.rateLimit !== false) {
    const limiter = createRateLimiter(opts.rateLimit ?? {});
    app.addHook('onRequest', async (req, reply) => {
      const r = limiter.take(req.ip);
      if (r.ok) return;
      // One log line per refusal episode per IP, not per request (no log flood).
      if (r.firstRefusal) req.log.warn({ delivery: { verified: false, status: 429, reason: 'rate-limited', ip: req.ip } }, 'streams delivery');
      return reply.code(429).header('retry-after', String(r.retryAfterSec)).send({ ok: false, error: 'rate-limited' });
    });
  }

  // Raw bytes for every content type inside this (encapsulated) plugin scope: the HMAC must be computed
  // over the exact body QuickNode sent, so nothing may parse or re-serialize it first.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit }, (_req, body, done) => {
    done(null, body);
  });

  const logFile = opts.logFile;
  const writeRecord = async (record: Record<string, unknown>) => {
    if (!logFile) return;
    await mkdir(path.dirname(logFile), { recursive: true });
    await appendFile(logFile, `${JSON.stringify(record)}\n`);
  };

  app.post('/webhooks/streams', async (req, reply) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const nonce = header(req, 'x-qn-nonce');
    const timestamp = header(req, 'x-qn-timestamp');
    const signature = header(req, 'x-qn-signature');

    const contentEncoding = header(req, 'content-encoding');
    let gzip = isGzip(raw, contentEncoding);
    let decoded: Buffer | null = null;
    let decodeError: string | undefined;

    let status: 200 | 400 | 401 | 413 | 500 | 503;
    let reason: string | undefined;
    // Cheap checks first: no decompression or parsing for requests that can't possibly verify (D-308).
    if (!opts.secret) {
      status = 503;
      reason = 'secret-unset';
    } else if (!nonce || !timestamp || !signature) {
      status = 401;
      reason = 'missing-signature-headers';
    } else {
      let tooLarge = false;
      try {
        ({ body: decoded, gzip } = decodeBody(raw, contentEncoding, maxDecoded));
      } catch (err) {
        decodeError = (err as Error).message;
        tooLarge = err instanceof DecodedBodyTooLarge;
      }
      if (tooLarge) {
        status = 413; // over the cap: rejected like other unauthenticated requests, never 500 (no retry loop)
        reason = 'decoded-body-too-large';
      } else if (!decoded) {
        status = 400;
        reason = 'body-decode-failed';
      } else if (!signatureMatches(computeSignature(opts.secret, nonce, timestamp, decoded), signature)) {
        status = 401;
        reason = 'bad-signature';
      } else {
        status = 200;
      }
    }
    const verified = status === 200;

    const ts = timestamp ? timestampSkew(timestamp) : null;
    if (verified && ts && ts.skewSec !== null && Math.abs(ts.skewSec) > maxSkewSec) {
      req.log.warn({ skewSec: ts.skewSec, unit: ts.unit }, 'streams webhook timestamp skew (not rejected)');
    }

    let summary: DeliverySummary | null = null;
    let json: unknown;
    let jsonError: string | undefined;
    if (verified && decoded && decoded.length > 0) {
      try {
        json = JSON.parse(decoded.toString('utf8'));
        summary = summarize(json);
      } catch (err) {
        jsonError = (err as Error).message;
      }
    }

    // Persist only after the HMAC verdict, and only verified deliveries (D-305).
    let rowId: number | undefined;
    let duplicate = false;
    let streamId: string | null = null;
    let batch: { start: number | null; end: number | null } = { start: null, end: null };
    if (verified) {
      const row = buildDeliveryRow({ headers: req.headers, bytes: raw.length, gzip, bodyText: decoded!.toString('utf8'), json, summary });
      streamId = row.streamId ?? null;
      batch = { start: row.batchStart ?? null, end: row.batchEnd ?? null };
      if (opts.store) {
        try {
          const stored = await opts.store(row);
          rowId = stored.id;
          duplicate = stored.duplicate === true;
        } catch (err) {
          status = 500;
          reason = 'persist-failed';
          req.log.error({ err: (err as Error).message }, 'streams delivery not persisted; answering 500 so QuickNode retries');
        }
      }
    }

    // Phase 2 (D-306): ingest only a durable row. Ingest errors never change the status (the raw row is the source of truth).
    let ingest: Record<string, unknown> | undefined;
    // A duplicate raw row (replay / retry of a stored batch) is not re-ingested: its first copy already was (or is retried
    // from the raw table). SEC-2-10c: the request waits at most ingestWaitMs; a slow ingest continues in the background.
    if (status === 200 && rowId !== undefined && opts.ingest && !duplicate) {
      const id = rowId;
      const run = opts.ingest(id, json ?? null).then(
        (r) => ({ ok: true as const, newEvents: r.newEvents, duplicates: r.duplicates, ignored: r.ignored, rebuilt: r.rebuilt, cursorBlock: r.cursor.lastBlock, events: r.cursor.events }),
        (err: unknown) => {
          req.log.error({ rowId: id, err: (err as Error).message }, 'streams ingest failed; raw row kept, will retry from stream_deliveries');
          return { ok: false as const, error: (err as Error).message };
        },
      );
      let timer: NodeJS.Timeout | undefined;
      const waited = new Promise<{ ok: false; error: string; pending: true }>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, error: 'ingest-timeout', pending: true }), ingestWaitMs);
      });
      ingest = await Promise.race([run, waited]);
      clearTimeout(timer);
      if ('pending' in ingest) req.log.warn({ rowId: id, ingestWaitMs }, 'streams ingest still running after the wait; answering 200, it continues in the background');
    }

    await writeRecord({
      receivedAt: new Date().toISOString(),
      verified,
      status,
      ...(reason ? { reason } : {}),
      method: req.method,
      url: req.url,
      headers: req.headers,
      bytes: raw.length,
      gzip,
      timestamp: ts,
      ...(decoded && decoded.length <= (verified ? Infinity : SPIKE_LOG_BODY_MAX) ? { body: decoded.toString('utf8') } : {}),
      ...(!decoded && !gzip && raw.length <= SPIKE_LOG_BODY_MAX ? { body: raw.toString('utf8') } : {}),
      ...((gzip || !decoded) && raw.length <= SPIKE_LOG_BODY_MAX ? { rawBodyBase64: raw.toString('base64') } : {}),
      ...(decodeError ? { decodeError } : {}),
      ...(jsonError ? { jsonError } : {}),
      ...(rowId !== undefined ? { rowId } : {}),
      summary,
    });

    // One structured line per request. Event labels/ranges only for verified bodies (unverified bodies are sender-controlled, QE-07).
    req.log.info(
      {
        delivery: {
          verified,
          status,
          ...(reason ? { reason } : {}),
          bytes: raw.length,
          ...(verified
            ? {
                rowId: rowId ?? null,
                streamId,
                batchStart: batch.start,
                batchEnd: batch.end,
                eventCount: summary?.logCount ?? 0,
                eventNames: summary?.eventNames ?? [],
                blocks: summary?.blockRange ?? null,
                shape: summary?.shape ?? null,
                ...(duplicate ? { duplicate: true } : {}),
                ...(ingest ? { ingest } : {}),
              }
            : {}),
        },
      },
      'streams delivery',
    );
    if (status !== 200) return reply.code(status).send({ ok: false, error: reason });
    return reply.code(200).send({ ok: true, bytes: raw.length, logs: summary?.logCount ?? 0, ...(duplicate ? { duplicate: true } : {}), ...(ingest ? { ingested: ingest.ok === true } : {}) });
  });
}
