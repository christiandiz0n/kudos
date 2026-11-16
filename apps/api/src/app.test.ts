import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from './app';

// Webhook (HMAC) cases live in webhooks.test.ts.
test('GET /health (in-memory PGlite)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vouch-api-'));
  const { app } = await buildApp(
    { databaseUrl: 'pglite://memory', streamsSpikeLog: path.join(dir, 'streams.ndjson') },
    { logger: false },
  );
  try {
    const health = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200);
    const body = health.json();
    assert.equal(body.ok, true);
    assert.equal(body.db.kind, 'pglite');
    assert.equal(body.db.ok, true);
  } finally {
    await app.close();
  }
});
