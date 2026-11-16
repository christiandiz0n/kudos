import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { FILTER_TEMPLATE, normalizeWebhookUrl, parseEvents, redactStream, redactUrl, renderFilter, writeEnvVar } from './lib';

const HELLO = '0x66cb4392322b2aede460a4314ce092e0cc1c2b32';
const PING_T0 = '0x20aede858ee515bfb2b198e62ba10a8133ae61e0c55d61c40b4c6d4191c0ca55'; // INTERFACES §4
const SPLIT_T0 = '0x42fb8796ffe3237a1f58f3e03a85a890f71c1582e5ef97e78936c4f5b6968cd9';
const SYSTEM = '0xfffffffffffffffffffffffffffffffffffffffe'; // Arc EIP-7708 system emitter (D-102)
const TRANSFER_T0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** Loads a rendered filter in a bare V8 context (no require/process), like QuickNode's sandbox. */
function load(src: string): (stream: unknown) => unknown {
  const main = vm.runInNewContext(`${src}\n;main`, {}) as (s: unknown) => unknown;
  return (s) => JSON.parse(JSON.stringify(main(s) ?? null)); // normalize cross-realm objects
}

const log = (address: string, topic0: string, block: number, tx: string, logIndex: number) => ({
  address,
  topics: [topic0, '0x000000000000000000000000' + '11'.repeat(20)],
  data: '0x' + '00'.repeat(64),
  blockNumber: '0x' + block.toString(16),
  transactionHash: tx,
  transactionIndex: '0x0',
  blockHash: '0x' + 'ab'.repeat(32),
  logIndex: '0x' + logIndex.toString(16),
  removed: false,
});
const META = { stream_id: 's-1', network: 'arc-testnet', dataset: 'logs', batch_start_range: 72567878, batch_end_range: 72567882 };

const main = load(renderFilter([HELLO], parseEvents('hello')));

test('parseEvents: "hello" preset and explicit signatures give the INTERFACES §4 topic0s', () => {
  const preset = parseEvents('hello');
  assert.deepEqual(preset.map((e) => [e.name, e.topic0]), [['Ping', PING_T0], ['Split', SPLIT_T0]]);
  const explicit = parseEvents('Ping(address,bytes32,uint256); event Split(address indexed token, address indexed from, address indexed relayer, uint256 recipientCount, uint256 total)');
  assert.deepEqual(explicit.map((e) => e.topic0), [PING_T0, SPLIT_T0]);
});

test('renderFilter fills both placeholders; the template alone keeps nothing', () => {
  const src = renderFilter([HELLO.toUpperCase().replace('0X', '0x')], parseEvents('hello'));
  assert.match(src, new RegExp(`const ADDRESSES = \\["${HELLO}"\\]`));
  assert.match(src, new RegExp(`"${PING_T0}": "Ping"`));
  const unfilled = load(readFileSync(FILTER_TEMPLATE, 'utf8'));
  assert.equal(unfilled({ data: [[[log(HELLO, PING_T0, 1, '0xaa', 0)]]], metadata: META }), null);
});

test('documented nesting data[block][receipt][log]: keeps only our address + topics', () => {
  const out = main({
    data: [
      [[log(SYSTEM, TRANSFER_T0, 72567880, '0xaa', 0), log(HELLO, PING_T0, 72567880, '0xaa', 1)]],
      [[log('0x' + '22'.repeat(20), PING_T0, 72567881, '0xbb', 0)], [log(HELLO, TRANSFER_T0, 72567881, '0xcc', 0)]],
      [],
    ],
    metadata: META,
  }) as any;
  assert.equal(out.v, 1);
  assert.equal(out.streamId, 's-1');
  assert.equal(out.batchStart, 72567878);
  assert.equal(out.batchEnd, 72567882);
  assert.equal(out.events.length, 1);
  assert.deepEqual(
    { ...out.events[0], topics: undefined, data: undefined },
    {
      event: 'Ping',
      address: HELLO,
      topics: undefined,
      data: undefined,
      blockNumber: 72567880,
      blockHash: '0x' + 'ab'.repeat(32),
      transactionHash: '0xaa',
      transactionIndex: 0,
      logIndex: 1,
      removed: false,
    },
  );
});

test('prose nesting data[block][log], checksummed address, blockTimestamp passthrough', () => {
  const checksummed = '0x66Cb4392322B2aeDe460a4314CE092E0Cc1C2b32';
  const l = { ...log(checksummed, SPLIT_T0, 72567926, '0xdd', 3), blockTimestamp: '0x6afb19e9' };
  const out = main({ data: [[l], [log(HELLO, PING_T0, 72567927, '0xee', 0)]], metadata: META }) as any;
  assert.deepEqual(out.events.map((e: any) => [e.event, e.blockNumber, e.logIndex]), [['Split', 72567926, 3], ['Ping', 72567927, 0]]);
  assert.equal(out.events[0].blockTimestamp, 0x6afb19e9);
  assert.equal('blockTimestamp' in out.events[1], false);
});

test('unwrapped payload (no {data, metadata}) and receipt-like objects with .logs', () => {
  const out = main([[{ transactionHash: '0xff', logs: [log(HELLO, PING_T0, 5, '0xff', 0)] }]]) as any;
  assert.equal(out.events.length, 1);
  assert.equal(out.batchStart, null);
});

test('no match → null (skip delivery)', () => {
  assert.equal(main({ data: [[[log(SYSTEM, TRANSFER_T0, 1, '0x1', 0)]], [[]]], metadata: META }), null);
  assert.equal(main({ data: [], metadata: META }), null);
  assert.equal(main({ data: null, metadata: META }), null);
  assert.equal(main({ data: [[[{ address: HELLO }]]], metadata: META }), null); // malformed log: no topics
});

test('writeEnvVar: replaces in place, keeps other lines + mode; appends when absent', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vouch-env-'));
  const f = path.join(dir, 'env');
  const original = '# header\nA=1\nSTREAMS_WEBHOOK_SECRET=__placeholder__\n# STREAMS_WEBHOOK_SECRET=commented\nB="two words"\n';
  await writeFile(f, original, { mode: 0o600 });
  const r1 = await writeEnvVar(f, 'STREAMS_WEBHOOK_SECRET', 'qn_abc123');
  assert.equal(r1.replaced, 1);
  assert.equal(await readFile(f, 'utf8'), original.replace('__placeholder__', 'qn_abc123'));
  assert.equal((await stat(f)).mode & 0o777, 0o600);

  const g = path.join(dir, 'env2');
  await writeFile(g, 'A=1', { mode: 0o640 });
  const r2 = await writeEnvVar(g, 'STREAMS_WEBHOOK_SECRET', 'with space#x');
  assert.equal(r2.replaced, 0);
  assert.equal(await readFile(g, 'utf8'), 'A=1\nSTREAMS_WEBHOOK_SECRET="with space#x"\n');
  assert.equal((await stat(g)).mode & 0o777, 0o640);
});

test('redaction: urls, tokens, headers, filter', () => {
  assert.equal(redactUrl('https://u:p@x.trycloudflare.com/webhooks/streams?token=abc#f'), '<creds>@https://x.trycloudflare.com/webhooks/streams?<redacted>#<redacted>');
  const r = redactStream({
    id: '1',
    filter_function: 'Zm9v',
    destination_attributes: { url: 'https://a.b/c?k=v', security_token: 'qn_secret_value', headers: { Authorization: 'Bearer x' } },
  });
  assert.equal(JSON.stringify(r).includes('qn_secret_value'), false);
  assert.equal(JSON.stringify(r).includes('Bearer x'), false);
  assert.equal((r.destination_attributes as any).security_token, '<redacted: 15 chars>');
  assert.equal(redactStream({ filter_function: 'Zm9v' }, true).filter_function, 'foo');
});

test('normalizeWebhookUrl appends the route to a bare tunnel origin', () => {
  assert.deepEqual(normalizeWebhookUrl('https://abc.trycloudflare.com'), { url: 'https://abc.trycloudflare.com/webhooks/streams', appended: true });
  assert.equal(normalizeWebhookUrl('https://abc.trycloudflare.com/webhooks/streams').appended, false);
  assert.throws(() => normalizeWebhookUrl('http://abc.example.com/x'));
});
