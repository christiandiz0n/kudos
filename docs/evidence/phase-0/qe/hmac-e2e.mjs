// QE_E2E: end-to-end HMAC check against a REAL running api (POST /webhooks/streams), built only from INTERFACES §6:
//   X-QN-Signature = hex(HMAC-SHA256(key = utf8(secret), msg = nonce + timestamp + body))
// Body = envelope v1 produced by running the rendered filter on a realistic logs payload containing the real
// Arc Ping log (block 72567880) fetched via eth_getLogs.
// Usage: node hmac-e2e.mjs <baseUrl> <secret> <rendered-filter.js>
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import vm from 'node:vm';
import path from 'node:path';

const [base, secret, filterPath] = process.argv.slice(2);
const dir = path.dirname(new URL(import.meta.url).pathname);
const lines = readFileSync(filterPath, 'utf8').split('\n');
const src = lines.slice(lines.findIndex((l) => l.startsWith('//'))).join('\n');
const block = JSON.parse(readFileSync(path.join(dir, 'arc-logs-block-72567880.json'), 'utf8')).result;
const byTx = Object.values(block.reduce((m, l) => ((m[l.transactionHash] ??= []).push(l), m), {}));
const stream = {
  data: [byTx],
  metadata: { stream_id: 'qe-local-0000', network: 'arc-testnet', dataset: 'logs', batch_start_range: 72567878, batch_end_range: 72567882 },
};
const envelope = vm.runInContext(`${src}\n;main(__in);`, vm.createContext({ __in: stream }));
const body = JSON.stringify(envelope);

const sign = (s, nonce, ts, b) => createHmac('sha256', Buffer.from(s, 'utf8')).update(nonce + ts).update(b).digest('hex');
const post = async (label, { headers = {}, payload }) => {
  const r = await fetch(`${base}/webhooks/streams`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stream-id': 'qe-local-0000', 'batch-start-range': '72567878', 'batch-end-range': '72567882', ...headers },
    body: payload,
  });
  const text = await r.text();
  console.log(`${label.padEnd(48)} HTTP ${r.status}  ${text}`);
  return r.status;
};

const nonce = randomUUID();
const ts = String(Math.floor(Date.now() / 1000));
const sig = sign(secret, nonce, ts, body);
console.log(`body bytes=${Buffer.byteLength(body)} events=${envelope.events.map((e) => `${e.event}@${e.blockNumber}:${e.transactionHash}`).join(',')}`);

const results = [];
results.push(['(a) correctly signed', 200, await post('(a) correctly signed', { headers: { 'x-qn-nonce': nonce, 'x-qn-timestamp': ts, 'x-qn-signature': sig }, payload: body })]);
const tampered = body.replace('"Ping"', '"Pong"');
results.push(['(b) tampered body, original signature', 401, await post('(b) tampered body, original signature', { headers: { 'x-qn-nonce': nonce, 'x-qn-timestamp': ts, 'x-qn-signature': sig }, payload: tampered })]);
results.push(['(c) missing all X-QN headers', 401, await post('(c) missing all X-QN headers', { payload: body })]);
results.push(['(c2) missing only X-QN-Signature', 401, await post('(c2) missing only X-QN-Signature', { headers: { 'x-qn-nonce': nonce, 'x-qn-timestamp': ts }, payload: body })]);
results.push(['(d) signed with a different secret', 401, await post('(d) signed with a different secret', { headers: { 'x-qn-nonce': nonce, 'x-qn-timestamp': ts, 'x-qn-signature': sign('wrong', nonce, ts, body) }, payload: body })]);
results.push(['(e) uppercase hex signature', 200, await post('(e) uppercase hex signature', { headers: { 'x-qn-nonce': nonce, 'x-qn-timestamp': ts, 'x-qn-signature': sig.toUpperCase() }, payload: body })]);
results.push(['(f) gzip body, sig over decoded JSON', 200, await post('(f) gzip body, sig over decoded JSON', { headers: { 'content-encoding': 'gzip', 'x-qn-nonce': nonce, 'x-qn-timestamp': ts, 'x-qn-signature': sig }, payload: gzipSync(body) })]);
const tsMs = String(Date.now());
results.push(['(g) ms timestamp (13 digits), correctly signed', 200, await post('(g) ms timestamp (13 digits), correctly signed', { headers: { 'x-qn-nonce': nonce, 'x-qn-timestamp': tsMs, 'x-qn-signature': sign(secret, nonce, tsMs, body) }, payload: body })]);
let bad = 0;
for (const [l, exp, got] of results) if (exp !== got) { bad++; console.log(`MISMATCH ${l}: expected ${exp} got ${got}`); }
console.log(bad ? `${bad} mismatch(es)` : `all ${results.length} responses as expected`);
