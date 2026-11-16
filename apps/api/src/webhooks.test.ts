import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { realSecret } from './env';
import { summarize, timestampSkew } from './routes/webhooks';

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

describe('POST /webhooks/streams with STREAMS_WEBHOOK_SECRET set', () => {
  let app: FastifyInstance;
  let logFile: string;
  before(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vouch-wh-'));
    logFile = path.join(dir, 'streams.ndjson');
    ({ app } = await buildApp(
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
    const res = await app.inject({
      method: 'POST',
      url: WH_URL,
      headers: { ...signedHeaders(PAYLOAD), 'content-encoding': 'gzip' },
      payload: gzipSync(Buffer.from(PAYLOAD)),
    });
    assert.equal(res.statusCode, 200);
    const rec = await lastRecord(logFile);
    assert.equal(rec.gzip, true);
    assert.equal(rec.body, PAYLOAD);
  });
});

test('STREAMS_WEBHOOK_SECRET unset → 503 (fail closed), even with a "valid-looking" signature', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vouch-wh-'));
  const logFile = path.join(dir, 'streams.ndjson');
  const { app } = await buildApp(
    { databaseUrl: 'pglite://memory', streamsSpikeLog: logFile, streamsWebhookSecret: undefined },
    { logger: false },
  );
  try {
    const res = await app.inject({ method: 'POST', url: WH_URL, headers: signedHeaders(PAYLOAD), payload: PAYLOAD });
    assert.equal(res.statusCode, 503);
    assert.equal((await lastRecord(logFile)).reason, 'secret-unset');
  } finally {
    await app.close();
  }
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
