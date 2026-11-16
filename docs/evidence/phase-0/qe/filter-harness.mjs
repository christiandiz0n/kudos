// QE_E2E: run the rendered QuickNode filter (render-filter output) in a bare vm context against payloads
// built from REAL Arc eth_getLogs results. Usage (repo root):
//   node docs/evidence/phase-0/qe/filter-harness.mjs docs/evidence/phase-0/qe/rendered-filter-hello.js
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const raw = readFileSync(process.argv[2], 'utf8');

// 1) Is the CLI output runnable as-is?
try {
  new vm.Script(raw);
  console.log('render-filter stdout parses as JS as-is: YES');
} catch (e) {
  console.log(`render-filter stdout parses as JS as-is: NO (${e.name}: ${e.message})`);
}
// Strip the CLI's "contracts:/topic" preamble lines (everything before the first "//" comment line).
const lines = raw.split('\n');
const src = lines.slice(lines.findIndex((l) => l.startsWith('//'))).join('\n');

const run = (stream) => {
  const ctx = vm.createContext({ __in: JSON.parse(JSON.stringify(stream)) }); // no require/process in context
  return vm.runInContext(`${src}\n;main(__in);`, ctx, { timeout: 1000 });
};

const logsOf = (b) => JSON.parse(readFileSync(path.join(dir, `arc-logs-block-${b}.json`), 'utf8')).result;
const pingBlock = logsOf(72567880); // contains the real Hello Ping + unrelated logs
const splitBlock = logsOf(72567926); // contains the real Split + 7 USDC Transfer + 6 system 0xffff…fffe logs
const otherBlock = logsOf(72567881); // no Hello log at all

const byTx = (logs) => Object.values(logs.reduce((m, l) => ((m[l.transactionHash] ??= []).push(l), m), {}));
const meta = {
  stream_id: 'qe-local', network: 'arc-testnet', dataset: 'logs',
  batch_start_range: 72567878, batch_end_range: 72567882,
};

const cases = [];
// A) documented 3-deep nesting {data:[block][receipt][log], metadata}
cases.push(['3-deep nested {data,metadata}: ping block + empty block', { data: [byTx(pingBlock), byTx(otherBlock)], metadata: meta }, ['Ping']]);
cases.push(['3-deep nested {data,metadata}: split block', { data: [byTx(splitBlock)], metadata: { ...meta, batch_start_range: 72567926, batch_end_range: 72567926 } }, ['Split']]);
cases.push(['3-deep nested: ping + split blocks together', { data: [byTx(pingBlock), byTx(splitBlock)], metadata: meta }, ['Ping', 'Split']]);
// B) unwrapped (no {data,metadata} wrapper) — [block][log] and [block][receipt][log]
cases.push(['unwrapped [block][log]: ping block', [pingBlock, otherBlock], ['Ping']]);
cases.push(['unwrapped [block][receipt][log]: split block', [byTx(splitBlock)], ['Split']]);
// C) unrelated logs only → null
const usdcOnly = splitBlock.filter((l) => l.address.toLowerCase() === '0x3600000000000000000000000000000000000000');
const sysOnly = splitBlock.filter((l) => l.address.toLowerCase() === '0xfffffffffffffffffffffffffffffffffffffffe');
cases.push([`unrelated: USDC Transfer logs only (${usdcOnly.length})`, { data: [[usdcOnly]], metadata: meta }, null]);
cases.push([`unrelated: system 0xffff…fffe logs only (${sysOnly.length})`, { data: [[sysOnly]], metadata: meta }, null]);
cases.push(['unrelated: block 72567881 (no Hello log)', { data: [byTx(otherBlock)], metadata: meta }, null]);
cases.push(['unwrapped unrelated: system log only', [[sysOnly[0]]], null]);
// D) Hello-address log whose topic0 is NOT Ping/Split (forged: Ping log with Transfer topic0) → null
const forged = { ...pingBlock.find((l) => l.address.toLowerCase() === '0x66cb4392322b2aede460a4314ce092e0cc1c2b32') };
forged.topics = ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', ...forged.topics.slice(1)];
cases.push(['Hello address but unknown topic0', { data: [[[forged]]], metadata: meta }, null]);

let fail = 0;
for (const [name, stream, expect] of cases) {
  const out = run(stream);
  const names = out ? out.events.map((e) => e.event) : null;
  const ok = JSON.stringify(names) === JSON.stringify(expect);
  if (!ok) fail++;
  console.log(`\n[${ok ? 'PASS' : 'FAIL'}] ${name}\n  expect ${JSON.stringify(expect)} got ${JSON.stringify(names)}`);
  if (out) {
    console.log(`  envelope v=${out.v} streamId=${out.streamId} network=${out.network} dataset=${out.dataset} batch=${out.batchStart}..${out.batchEnd}`);
    for (const e of out.events)
      console.log(`  ${e.event} block=${e.blockNumber} tx=${e.transactionHash} logIndex=${e.logIndex} blockTimestamp=${e.blockTimestamp} addr=${e.address}`);
  }
}
console.log(`\n${cases.length - fail}/${cases.length} cases as expected`);
process.exit(fail ? 1 : 0);
