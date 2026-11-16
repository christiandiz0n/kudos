import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { REPO_ROOT, resolvePort, resolveSpikeLog } from './env';

test('port: PORT (host-injected, e.g. Railway) wins over API_PORT, default 4000', () => {
  assert.equal(resolvePort({}), 4000);
  assert.equal(resolvePort({ API_PORT: '4100' }), 4100);
  assert.equal(resolvePort({ PORT: '8080' }), 8080);
  assert.equal(resolvePort({ PORT: '8080', API_PORT: '4100' }), 8080);
  assert.equal(resolvePort({ PORT: '', API_PORT: '4100' }), 4100, 'empty PORT counts as unset');
  assert.equal(resolvePort({ PORT: ' 8080 ' }), 8080);
  assert.throws(() => resolvePort({ PORT: 'abc' }), /invalid PORT/);
  assert.throws(() => resolvePort({ PORT: '70000' }), /invalid PORT/);
});

test('NDJSON spike log: on by default locally, off in production unless set, "off" disables', () => {
  const def = path.resolve(REPO_ROOT, 'data/local/streams-spike.ndjson');
  assert.equal(resolveSpikeLog({}), def);
  assert.equal(resolveSpikeLog({ NODE_ENV: 'development' }), def);
  assert.equal(resolveSpikeLog({ NODE_ENV: 'production' }), null);
  assert.equal(resolveSpikeLog({ NODE_ENV: 'production', STREAMS_SPIKE_LOG: 'data/x.ndjson' }), path.resolve(REPO_ROOT, 'data/x.ndjson'));
  assert.equal(resolveSpikeLog({ STREAMS_SPIKE_LOG: 'off' }), null);
  assert.equal(resolveSpikeLog({ STREAMS_SPIKE_LOG: '/tmp/a.ndjson' }), '/tmp/a.ndjson');
});
