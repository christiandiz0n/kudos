import { createHmac, timingSafeEqual } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildDeliveryRow, type NewDelivery } from '../streams/deliveries';

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
 * Behaviour:
 *   - STREAMS_WEBHOOK_SECRET unset/placeholder → 503 (fail closed).
 *   - missing/malformed headers or bad signature → 401.
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
  store?: (row: NewDelivery) => Promise<{ id: number }>;
  /**
   * Phase 2 (D-306): decode + ingest a delivery AFTER its raw row committed. A failure here is logged and recorded by
   * the ingester (ev_ingest_log) and retried from the raw table; the response stays 200 because the delivery is durable.
   */
  ingest?: (rowId: number, body: unknown) => Promise<IngestSummary>;
  /** QuickNode stream security token. Undefined → every delivery is answered 503. */
  secret: string | undefined;
  /** Log a warning when |now - X-QN-Timestamp| exceeds this (seconds). Never rejects. Default 300. */
  maxSkewSec?: number;
}

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

/** Body bytes the HMAC is computed over: gunzipped if the delivery is gzip-compressed. */
export function decodeBody(raw: Buffer, contentEncoding: string | undefined): { body: Buffer; gzip: boolean } {
  const gzipMagic = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b;
  const gzip = /gzip/i.test(contentEncoding ?? '') || gzipMagic;
  return gzip ? { body: gunzipSync(raw), gzip } : { body: raw, gzip };
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

  // Raw bytes for every content type inside this (encapsulated) plugin scope: the HMAC must be computed
  // over the exact body QuickNode sent, so nothing may parse or re-serialize it first.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 50 * 1024 * 1024 }, (_req, body, done) => {
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

    let decoded: Buffer | null = null;
    let gzip = false;
    let decodeError: string | undefined;
    try {
      ({ body: decoded, gzip } = decodeBody(raw, header(req, 'content-encoding')));
    } catch (err) {
      decodeError = (err as Error).message;
    }

    let status: 200 | 400 | 401 | 500 | 503;
    let reason: string | undefined;
    if (!opts.secret) {
      status = 503;
      reason = 'secret-unset';
    } else if (!nonce || !timestamp || !signature) {
      status = 401;
      reason = 'missing-signature-headers';
    } else if (!decoded) {
      status = 400;
      reason = 'body-decode-failed';
    } else if (!signatureMatches(computeSignature(opts.secret, nonce, timestamp, decoded), signature)) {
      status = 401;
      reason = 'bad-signature';
    } else {
      status = 200;
    }
    const verified = status === 200;

    const ts = timestamp ? timestampSkew(timestamp) : null;
    if (verified && ts && ts.skewSec !== null && Math.abs(ts.skewSec) > maxSkewSec) {
      req.log.warn({ skewSec: ts.skewSec, unit: ts.unit }, 'streams webhook timestamp skew (not rejected)');
    }

    let summary: DeliverySummary | null = null;
    let json: unknown;
    let jsonError: string | undefined;
    if (decoded && decoded.length > 0) {
      try {
        json = JSON.parse(decoded.toString('utf8'));
        summary = summarize(json);
      } catch (err) {
        jsonError = (err as Error).message;
      }
    }

    // Persist only after the HMAC verdict, and only verified deliveries (D-305).
    let rowId: number | undefined;
    let streamId: string | null = null;
    let batch: { start: number | null; end: number | null } = { start: null, end: null };
    if (verified) {
      const row = buildDeliveryRow({ headers: req.headers, bytes: raw.length, gzip, bodyText: decoded!.toString('utf8'), json, summary });
      streamId = row.streamId ?? null;
      batch = { start: row.batchStart ?? null, end: row.batchEnd ?? null };
      if (opts.store) {
        try {
          rowId = (await opts.store(row)).id;
        } catch (err) {
          status = 500;
          reason = 'persist-failed';
          req.log.error({ err: (err as Error).message }, 'streams delivery not persisted; answering 500 so QuickNode retries');
        }
      }
    }

    // Phase 2 (D-306): ingest only a durable row. Ingest errors never change the status (the raw row is the source of truth).
    let ingest: Record<string, unknown> | undefined;
    if (status === 200 && rowId !== undefined && opts.ingest) {
      try {
        const r = await opts.ingest(rowId, json ?? null);
        ingest = { ok: true, newEvents: r.newEvents, duplicates: r.duplicates, ignored: r.ignored, rebuilt: r.rebuilt, cursorBlock: r.cursor.lastBlock, events: r.cursor.events };
      } catch (err) {
        ingest = { ok: false, error: (err as Error).message };
        req.log.error({ rowId, err: (err as Error).message }, 'streams ingest failed; raw row kept, will retry from stream_deliveries');
      }
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
      ...(decoded ? { body: decoded.toString('utf8') } : {}),
      ...(gzip || !decoded ? { rawBodyBase64: raw.toString('base64') } : {}),
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
                ...(ingest ? { ingest } : {}),
              }
            : {}),
        },
      },
      'streams delivery',
    );
    if (status !== 200) return reply.code(status).send({ ok: false, error: reason });
    return reply.code(200).send({ ok: true, bytes: raw.length, logs: summary?.logCount ?? 0, ...(ingest ? { ingested: ingest.ok === true } : {}) });
  });
}
