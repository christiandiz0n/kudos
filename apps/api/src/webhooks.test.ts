import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import type { DbHandle } from './db/index';
import { realSecret } from './env';
import { summarize, timestampSkew } from './routes/webhooks';
import { listDeliveries, pickHeaders } from './streams/deliveries';

// Test-only token (not a real stream token).
const SECRET = 'test-security-token-0123456789abcdef0123456789';
const WH_URL = '/webhooks/streams';

/** Independent re-implementation of the QuickNode reference verifier (string concat, utf8, hex). */
function qnSign(secret: string, nonce: string, ts: string, payload: string): string {
  return createHmac('sha256', Buffer.from(secret, 'utf8')).update(Buffer.from(nonce + ts + payload, 'utf8')).digest('hex');
}

// Shape of a delivery produced by infra/streams/filter-logs.js (envelope v1).
const PAYLOAD = JSON.stringify({
  v: 1,
  streamId: 'stream-test',
  network: 'arc-testnet',
  dataset: 'logs',
  batchStart: 72567878,
  batchEnd: 72567882,
  events: [
    {
      event: 'Ping',
      address: '0x66cb4392322b2aede460a4314ce092e0cc1c2b32',
      topics: ['0x20aede858ee515bfb2b198e62ba10a8133ae61e0c55d61c40b4c6d4191c0ca55', '0x' + '00'.repeat(12) + '11'.repeat(20)],
      data: '0x' + '00'.repeat(64),
      blockNumber: 72567880,
      blockHash: '0x' + 'ab'.repeat(32),
      transactionHash: '0x6a6ad1c21d288b0eec21559da434b3a6a991406bc45ac69c024c4a2aa344a3d0',
      transactionIndex: 0,
      logIndex: 0,
      removed: false,
    },
  ],
});

function signedHeaders(payload: string, secret = SECRET) {
  const nonce = 'nonce-' + Math.random().toString(36).slice(2);
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    'content-type': 'application/json',
    'x-qn-nonce': nonce,
    'x-qn-timestamp': ts,
    'x-qn-signature': qnSign(secret, nonce, ts, payload),
  };
}

async function lastRecord(logFile: string) {
  const lines = (await readFile(logFile, 'utf8')).trim().split('\n');
  return JSON.parse(lines.at(-1)!);
}

async function rowCount(db: DbHandle) {
  return (await listDeliveries(db, 1000)).length;
}

describe('POST /webhooks/streams with STREAMS_WEBHOOK_SECRET set', () => {
  let app: FastifyInstance;
  let db: DbHandle;
  let logFile: string;
  before(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vouch-wh-'));
    logFile = path.join(dir, 'streams.ndjson');
    ({ app, db } = await buildApp(
      { databaseUrl: 'pglite://memory', streamsSpikeLog: logFile, streamsWebhookSecret: SECRET },
      { logger: false },
    ));
  });
  after(async () => app.close());

  test('valid signature → 200, NDJSON line verified with parsed summary', async () => {
    const res = await app.inject({ method: 'POST', url: WH_URL, headers: signedHeaders(PAYLOAD), payload: PAYLOAD });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true, bytes: Buffer.byteLength(PAYLOAD), logs: 1 });
    const rec = await lastRecord(logFile);
    assert.equal(rec.verified, true);
    assert.equal(rec.body, PAYLOAD);
    assert.equal(typeof rec.headers['x-qn-signature'], 'string');
    assert.equal(rec.summary.logCount, 1);
    assert.deepEqual(rec.summary.blockRange, { from: 72567880, to: 72567880 });
    assert.deepEqual(rec.summary.eventNames, ['Ping']);
    assert.deepEqual(rec.summary.batch, { start: 72567878, end: 72567882 });
    assert.deepEqual(rec.summary.topic0s, ['0x20aede858ee515bfb2b198e62ba10a8133ae61e0c55d61c40b4c6d4191c0ca55']);
    assert.equal(rec.timestamp.unit, 's');
    assert.equal(typeof rec.rowId, 'number');
  });

  test('verified delivery → one stream_deliveries row (headers allow-listed, signature not stored)', async () => {
    const before = await rowCount(db);
    const headers = { ...signedHeaders(PAYLOAD), 'stream-id': 'qn-stream-123', 'batch-start-range': '72567879', 'batch-end-range': '72567883' };
    const res = await app.inject({ method: 'POST', url: WH_URL, headers, payload: PAYLOAD });
    assert.equal(res.statusCode, 200);
    const rows = await listDeliveries(db, 1000);
    assert.equal(rows.length, before + 1);
    const row = rows[0]!;
    assert.equal(row.verified, true);
    assert.equal(row.streamId, 'qn-stream-123', 'stream-id header wins over the body streamId');
    assert.equal(row.batchStart, 72567879, 'batch-* headers are authoritative (QE-15)');
    assert.equal(row.batchEnd, 72567883);
    assert.equal(row.eventCount, 1);
    assert.equal(row.bytes, Buffer.byteLength(PAYLOAD));
    assert.equal(row.gzip, false);
    assert.deepEqual(row.body, JSON.parse(PAYLOAD));
    assert.equal(row.bodyText, null);
    assert.equal(row.headers['x-qn-nonce'], headers['x-qn-nonce']);
    assert.equal(row.headers['stream-id'], 'qn-stream-123');
    assert.equal(row.headers['x-qn-signature'], undefined, 'the signature is never stored');
    assert.deepEqual((row.summary as { eventNames: string[] }).eventNames, ['Ping']);
    assert.ok(row.receivedAt instanceof Date);
  });

  test('verified delivery without batch headers → body envelope streamId/batch used', async () => {
    const res = await app.inject({ method: 'POST', url: WH_URL, headers: signedHeaders(PAYLOAD), payload: PAYLOAD });
    assert.equal(res.statusCode, 200);
    const [row] = await listDeliveries(db, 1);
    assert.equal(row!.streamId, 'stream-test');
    assert.equal(row!.batchStart, 72567878);
    assert.equal(row!.batchEnd, 72567882);
  });

  test('verified non-JSON body → row with body_text, body null', async () => {
    const text = 'not json';
    const res = await app.inject({ method: 'POST', url: WH_URL, headers: { ...signedHeaders(text), 'content-type': 'text/plain' }, payload: text });
    assert.equal(res.statusCode, 200);
    const [row] = await listDeliveries(db, 1);
    assert.equal(row!.body, null);
    assert.equal(row!.bodyText, text);
    assert.equal(row!.eventCount, 0);
  });

  test('rejected requests (401 bad/missing signature) store no row', async () => {
    const before = await rowCount(db);
    const tampered = PAYLOAD.replace('"logIndex":0', '"logIndex":1');
    const bad = await app.inject({ method: 'POST', url: WH_URL, headers: signedHeaders(PAYLOAD), payload: tampered });
    const unsigned = await app.inject({ method: 'POST', url: WH_URL, headers: { 'content-type': 'application/json' }, payload: '{}' });
    const forged = await app.inject({
      method: 'POST',
      url: WH_URL,
      headers: { 'content-type': 'application/json', 'x-qn-nonce': 'n', 'x-qn-timestamp': '1', 'x-qn-signature': '0'.repeat(64) },
      payload: PAYLOAD,
    });
    assert.deepEqual([bad.statusCode, unsigned.statusCode, forged.statusCode], [401, 401, 401]);
    assert.equal(await rowCount(db), before);
  });

  test('tampered body → 401', async () => {
    const headers = signedHeaders(PAYLOAD);
    const tampered = PAYLOAD.replace('"logIndex":0', '"logIndex":1');
    assert.notEqual(tampered, PAYLOAD);
    const res = await app.inject({ method: 'POST', url: WH_URL, headers, payload: tampered });
    assert.equal(res.statusCode, 401);
    const rec = await lastRecord(logFile);
    assert.equal(rec.verified, false);
    assert.equal(rec.reason, 'bad-signature');
  });

  test('signature made with another token → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: WH_URL,
      headers: signedHeaders(PAYLOAD, 'some-other-token-0123456789abcdef0123'),
      payload: PAYLOAD,
    });
    assert.equal(res.statusCode, 401);
  });

  test('missing signature headers → 401', async () => {
    const full = signedHeaders(PAYLOAD);
    for (const drop of ['x-qn-nonce', 'x-qn-timestamp', 'x-qn-signature'] as const) {
      const headers: Record<string, string> = { ...full };
      delete headers[drop];
      const res = await app.inject({ method: 'POST', url: WH_URL, headers, payload: PAYLOAD });
      assert.equal(res.statusCode, 401, `without ${drop}`);
      assert.equal((await lastRecord(logFile)).reason, 'missing-signature-headers');
    }
    const none = await app.inject({ method: 'POST', url: WH_URL, headers: { 'content-type': 'application/json' }, payload: PAYLOAD });
    assert.equal(none.statusCode, 401);
  });

  test('gzip body: HMAC over the decoded JSON → 200', async () => {
    const gz = gzipSync(Buffer.from(PAYLOAD));
    const res = await app.inject({
      method: 'POST',
      url: WH_URL,
      headers: { ...signedHeaders(PAYLOAD), 'content-encoding': 'gzip' },
      payload: gz,
    });
    assert.equal(res.statusCode, 200);
    const rec = await lastRecord(logFile);
    assert.equal(rec.gzip, true);
    assert.equal(rec.body, PAYLOAD);
    const [row] = await listDeliveries(db, 1);
    assert.equal(row!.gzip, true);
    assert.equal(row!.bytes, gz.length, 'bytes = as received (compressed)');
    assert.deepEqual(row!.body, JSON.parse(PAYLOAD));
  });
});

test('STREAMS_WEBHOOK_SECRET unset → 503 (fail closed), even with a "valid-looking" signature', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vouch-wh-'));
  const logFile = path.join(dir, 'streams.ndjson');
  const { app, db } = await buildApp(
    { databaseUrl: 'pglite://memory', streamsSpikeLog: logFile, streamsWebhookSecret: undefined },
    { logger: false },
  );
  try {
    const res = await app.inject({ method: 'POST', url: WH_URL, headers: signedHeaders(PAYLOAD), payload: PAYLOAD });
    assert.equal(res.statusCode, 503);
    assert.equal((await lastRecord(logFile)).reason, 'secret-unset');
    assert.equal(await rowCount(db), 0, '503 stores no row');
  } finally {
    await app.close();
  }
});

test('verified delivery whose insert fails → 500 (QuickNode retries), not a silent 200', async () => {
  const fresh = await buildApp({ databaseUrl: 'pglite://memory', streamsSpikeLog: null, streamsWebhookSecret: SECRET }, { logger: false });
  try {
    await fresh.db.close(); // make the insert fail
    const res = await fresh.app.inject({ method: 'POST', url: WH_URL, headers: signedHeaders(PAYLOAD), payload: PAYLOAD });
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.json(), { ok: false, error: 'persist-failed' });
  } finally {
    await fresh.app.close().catch(() => {});
  }
});

test('NDJSON spike log disabled (null) → webhook still verifies and answers', async () => {
  const { app, db } = await buildApp({ databaseUrl: 'pglite://memory', streamsSpikeLog: null, streamsWebhookSecret: SECRET }, { logger: false });
  try {
    const res = await app.inject({ method: 'POST', url: WH_URL, headers: signedHeaders(PAYLOAD), payload: PAYLOAD });
    assert.equal(res.statusCode, 200);
    assert.equal(await rowCount(db), 1);
  } finally {
    await app.close();
  }
});

test('pickHeaders keeps QuickNode metadata, drops signature/auth/cookies', () => {
  const h = pickHeaders({
    'content-type': 'application/json',
    'x-qn-nonce': 'n',
    'x-qn-timestamp': '1',
    'x-qn-signature': 'f'.repeat(64),
    'stream-id': 's',
    'batch-start-range': '1',
    authorization: 'Bearer x',
    cookie: 'a=b',
    'x-forwarded-for': '1.2.3.4',
  });
  assert.deepEqual(h, { 'content-type': 'application/json', 'x-qn-nonce': 'n', 'x-qn-timestamp': '1', 'stream-id': 's', 'batch-start-range': '1' });
});

test('env placeholders count as unset', () => {
  assert.equal(realSecret('__streams_webhook_secret__'), undefined);
  assert.equal(realSecret(''), undefined);
  assert.equal(realSecret(undefined), undefined);
  assert.equal(realSecret('abc'), 'abc');
});

test('summarize: raw logs dataset nesting [block][receipt][log] and [block][log]', () => {
  const log = (b: string, tx: string) => ({ address: '0xA', topics: ['0xT0'], data: '0x', blockNumber: b, transactionHash: tx });
  const three = summarize({ data: [[[log('0x10', '0xaa')]], [[log('0x12', '0xbb'), log('0x12', '0xbb')]]], metadata: { batch_start_range: 16, batch_end_range: 20 } });
  assert.equal(three.logCount, 3);
  assert.deepEqual(three.blockRange, { from: 16, to: 18 });
  assert.deepEqual(three.txHashes, ['0xaa', '0xbb']);
  assert.deepEqual(three.batch, { start: 16, end: 20 });
  const two = summarize([[log('0x1', '0xcc')], []]);
  assert.equal(two.logCount, 1);
  assert.equal(two.shape, 'array[2]');
});

test('timestampSkew: seconds vs milliseconds', () => {
  const now = 1_800_000_000_000;
  assert.deepEqual(timestampSkew('1799999990', now), { unit: 's', skewSec: 10 });
  assert.deepEqual(timestampSkew('1799999990000', now), { unit: 'ms', skewSec: 10 });
  assert.deepEqual(timestampSkew('2026-11-16T00:00:00Z', now), { unit: 'unknown', skewSec: null });
});
