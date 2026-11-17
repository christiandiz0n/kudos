/**
 * SSE: a real listening server. "settled" arrives from STREAMS_INFRA's bus (the real `streams.bus` from buildApp);
 * "pending" is pushed by the relay routes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { zeroAddress, type Hex } from 'viem';
import type { Streams } from '../streams/index';
import { SseHub } from '../sse/hub';
import { P, makeApp, signIn } from './helpers';

function listen(url: string, headers: Record<string, string> = {}) {
  const frames: { event: string; data: any }[] = [];
  let status = 0;
  let resHeaders: http.IncomingHttpHeaders = {};
  const req = http.get(url, { headers: { accept: 'text/event-stream', ...headers } }, (res) => {
    status = res.statusCode ?? 0;
    resHeaders = res.headers;
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (ev && data) frames.push({ event: ev, data: JSON.parse(data) });
      }
    });
  });
  req.on('error', () => {});
  return {
    frames,
    get status() {
      return status;
    },
    get headers() {
      return resHeaders;
    },
    close: () => req.destroy(),
  };
}

const until = async (cond: () => boolean, ms = 2_000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

test('SSE: venue + user channels receive payment.settled / reward.paid from the Streams bus', async () => {
  const t = await makeApp();
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
  const venue = P.lena.address; // registered in the fake chain below: only known venues get a channel (SEC-2-06)
  t.chain.venues.set(venue.toLowerCase(), { owner: P.lena.address, termsVersion: 1, registeredAt: 0n, payout: P.lena.address, signer: P.venueSigner.address, attributor: P.attributor.address, terms: [{ version: 1, rewardBps: 1500, effectiveAt: 0n, minOrder: 0n }] });
  const ana = await signIn(t.app, P.ana);
  const v = listen(`${base}/events/venue/${venue}`, { origin: 'http://localhost:3100' });
  const u = listen(`${base}/events/user/${P.ana.address}?token=${encodeURIComponent(ana)}`);
  const forbidden = listen(`${base}/events/user/${P.ben.address}?token=${encodeURIComponent(ana)}`);
  const anon = listen(`${base}/events/user/${P.ana.address}`);
  try {
    await until(() => t.deps.sse.count(SseHub.venueChannel(venue)) === 1 && t.deps.sse.count(SseHub.userChannel(P.ana.address)) === 1);
    assert.equal(v.status, 200);
    assert.match(String(v.headers['content-type']), /text\/event-stream/);
    assert.equal(v.headers['access-control-allow-origin'], 'http://localhost:3100');
    await until(() => forbidden.status === 403 && anon.status === 401);
    const orderId = `0x${'22'.repeat(32)}` as Hex;
    const txHash = `0x${'33'.repeat(32)}` as Hex;
    const line = { orderId, venue, customer: P.ben.address, role: 1 as const, recipient: P.ana.address, amount: 693_000n, viaReferrer: P.ana.address, returned: false, returnReason: null, txHash, logIndex: 2, blockNumber: 5n, blockTime: null };
    (t.deps.streams as Streams).bus.publish({
      type: 'payment.settled',
      payment: {
        venue,
        customer: P.ben.address,
        orderId,
        amount: 12_000_000n,
        venueAmount: 10_200_000n,
        rewardPool: 1_800_000n,
        firstPurchase: true,
        rewarded: true,
        weightsMode: 1,
        txHash,
        logIndex: 1,
        blockNumber: 5n,
        blockTime: null,
        lines: [line, { ...line, role: 2, recipient: zeroAddress, returned: true, returnReason: 0, amount: 1n }],
      },
    });
    await until(() => v.frames.length >= 1 && u.frames.length >= 1);
    assert.equal(v.frames[0]!.event, 'payment.settled');
    assert.equal(v.frames[0]!.data.amount.baseUnits, '12000000');
    assert.equal(v.frames[0]!.data.source, 'streams');
    assert.equal(u.frames[0]!.event, 'reward.paid');
    assert.equal(u.frames[0]!.data.amount.baseUnits, '693000');
    assert.equal(u.frames.length, 1, 'returned share / zero recipient not pushed');
  } finally {
    for (const c of [v, u, forbidden, anon]) c.close();
    await t.close();
  }
});

test('SseHub: backpressure (write → false) drops the client; max age closes it; caps per client/channel/global', () => {
  let now = 0;
  const hub = new SseHub({ maxConnections: 3, maxPerIp: 2, maxPerChannel: 2, maxAgeMs: 1_000, heartbeatMs: 60_000, maxBufferedBytes: 100 }, () => now);
  const fake = (writeOk: boolean) => {
    const listeners: Record<string, (() => void)[]> = {};
    const res = {
      destroyed: false,
      writableEnded: false,
      writableLength: 0,
      writes: 0,
      writeHead() {
        return res;
      },
      write() {
        res.writes++;
        return writeOk || res.writes === 1; // first frame ("connected") fits, later ones hit backpressure
      },
      end() {
        res.writableEnded = true;
        for (const f of listeners.close ?? []) f();
      },
      destroy() {
        res.destroyed = true;
        for (const f of listeners.close ?? []) f();
      },
      on(ev: string, f: () => void) {
        (listeners[ev] ??= []).push(f);
        return res;
      },
    };
    return res;
  };
  const slow = fake(false);
  hub.attach('venue:a', slow as never, { ip: 'ip1' });
  hub.publish('venue:a', 'x', { a: 1 });
  assert.equal(slow.destroyed, true, 'dropped, not buffered');
  assert.equal(hub.count(), 0);
  const ok1 = fake(true);
  const ok2 = fake(true);
  hub.attach('venue:a', ok1 as never, { ip: 'ip1' });
  hub.attach('venue:b', ok2 as never, { ip: 'ip1' });
  assert.throws(() => hub.admit('venue:c', 'ip1'), /Too many live connections/);
  hub.attach('venue:a', fake(true) as never, { ip: 'ip2' });
  assert.throws(() => hub.admit('venue:a', 'ip3'), (e: unknown) => (e as { details?: { scope?: string } }).details?.scope !== undefined);
  now = 2_000;
  hub.heartbeat();
  assert.equal(ok1.writableEnded, true, 'closed after maxAgeMs');
  assert.equal(hub.count(), 0);
  hub.close();
});
