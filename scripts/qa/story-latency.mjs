#!/usr/bin/env node
/**
 * QE_E2E Phase 2 Part B: run `story:api` against an api and time tap→settled.
 * Spawns the pnpm script (which loads its own keys; this wrapper never reads the env file), timestamps every stdout
 * line, and as soon as the venue address is printed opens the PUBLIC SSE channel /events/venue/:venue and timestamps
 * every event. Then reads the canonical pay tx's block timestamp from chain.
 *
 *   node scripts/qa/story-latency.mjs --api https://api-production-902bc54c.up.railway.app --out <file.ndjson> [-- extra story args]
 */
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const API = opt('api').replace(/\/$/, '');
const OUT = opt('out');
const extra = argv.includes('--') ? argv.slice(argv.indexOf('--') + 1) : [];
const RPC = 'https://rpc.testnet.arc.io';
writeFileSync(OUT, '');
const rec = (o) => appendFileSync(OUT, `${JSON.stringify({ t: new Date().toISOString(), ms: Date.now(), ...o })}\n`);

let venue = null;
let sseAbort = null;
const sseEvents = [];

async function openSse(v) {
  const ctl = new AbortController();
  sseAbort = ctl;
  try {
    const res = await fetch(`${API}/events/venue/${v}`, { signal: ctl.signal, headers: { accept: 'text/event-stream' } });
    rec({ kind: 'sse-open', status: res.status, venue: v });
    if (res.status !== 200) {
      rec({ kind: 'sse-error', body: await res.text() });
      sseAbort = null; // retry on a later line
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.*)$/m.exec(block)?.[1] ?? 'message';
        const data = /^data: (.*)$/m.exec(block)?.[1] ?? '';
        if (block.startsWith(':')) continue;
        let tx = null;
        try {
          tx = JSON.parse(data).txHash ?? null;
        } catch {}
        const e = { kind: 'sse', event: ev, txHash: tx, bytes: data.length };
        sseEvents.push({ ...e, ms: Date.now() });
        rec(e);
      }
    }
  } catch (e) {
    if (!ctl.signal.aborted) rec({ kind: 'sse-error', err: String(e) });
  }
}

const child = spawn('pnpm', ['--silent', '--filter', '@vouch/scripts', 'story:api', '--', '--api', API, ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
let payHash = null;
let lineBuf = '';
const onLine = (line, stream) => {
  rec({ kind: stream, line });
  process.stdout.write(`${new Date().toISOString().slice(11, 23)} ${line}\n`);
  const m = /^\s*venue (0x[0-9a-fA-F]{40})\s+owner nonce/.exec(line);
  if (m && !venue) venue = m[1];
  // the public venue channel only opens for a venue known on chain (SEC-2-06): open it once registerVenue mined
  if (venue && !sseAbort && /✓ (registerVenue|setSeedAmbassador|acceptIntro)/.test(line)) openSse(venue);
  const p = /pay Ben \$12\.00 \(canonical\)\s+(0x[0-9a-f]{64})/.exec(line);
  if (p) payHash = p[1];
};
for (const [s, name] of [
  [child.stdout, 'stdout'],
  [child.stderr, 'stderr'],
]) {
  let b = '';
  s.on('data', (d) => {
    b += d.toString();
    let i;
    while ((i = b.indexOf('\n')) >= 0) {
      onLine(b.slice(0, i), name);
      b = b.slice(i + 1);
    }
  });
}
void lineBuf;
child.on('exit', async (code) => {
  rec({ kind: 'exit', code });
  // let SSE catch any trailing event, then close
  await new Promise((r) => setTimeout(r, 3000));
  sseAbort?.abort();
  if (payHash) {
    const call = async (method, params) => (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
    const r = await call('eth_getTransactionReceipt', [payHash]);
    const b = await call('eth_getBlockByNumber', [r.blockNumber, false]);
    rec({ kind: 'pay-block', txHash: payHash, block: parseInt(r.blockNumber), blockTimestamp: parseInt(b.timestamp) });
    const settledSse = sseEvents.find((e) => e.event === 'payment.settled' && e.txHash === payHash);
    console.log(`\npay ${payHash} block ${parseInt(r.blockNumber)} blockTime ${new Date(parseInt(b.timestamp) * 1000).toISOString()}`);
    console.log(`SSE payment.settled for this tx: ${settledSse ? new Date(settledSse.ms).toISOString() + ` (+${((settledSse.ms - parseInt(b.timestamp) * 1000) / 1000).toFixed(2)} s after block time)` : 'NOT RECEIVED'}`);
  }
  console.log(`story exit ${code}; events → ${OUT}`);
  process.exit(code ?? 1);
});
