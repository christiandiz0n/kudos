import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from './app';

test('GET /health and POST /webhooks/streams (in-memory PGlite)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wom-api-'));
  const logFile = path.join(dir, 'streams.ndjson');
  const { app } = await buildApp({ databaseUrl: 'pglite://memory', streamsSpikeLog: logFile }, { logger: false });
  try {
    const health = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200);
    const body = health.json();
    assert.equal(body.ok, true);
    assert.equal(body.db.kind, 'pglite');
    assert.equal(body.db.ok, true);

    const payload = JSON.stringify({ data: [{ hello: 'streams' }] });
    const hook = await app.inject({
      method: 'POST',
      url: '/webhooks/streams',
      headers: { 'content-type': 'application/json', 'x-test': '1' },
      payload,
    });
    assert.equal(hook.statusCode, 200);
    const line = JSON.parse((await readFile(logFile, 'utf8')).trim());
    assert.equal(line.body, payload);
    assert.equal(line.headers['x-test'], '1');
  } finally {
    await app.close();
  }
});
