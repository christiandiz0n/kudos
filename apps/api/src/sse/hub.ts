/**
 * SSE fan-out. Channels: `user:<address>` and `venue:<venue>` (lowercase). The relayer pushes "pending"/"failed";
 * STREAMS_INFRA's bus pushes "settled" (payment.settled, reward.paid, intro.accepted, customer.verified, …).
 * Each message: `id: <seq>\nevent: <type>\ndata: <json>\n\n`.
 *
 * Limits (SEC-2-06, D-809): a global, per-client-IP and per-channel connection cap (`admit` refuses before the
 * response is hijacked); a max connection age (clients reconnect via `retry:`); backpressure: a client whose socket
 * refuses a write (`res.write` → false) or whose unsent buffer exceeds `maxBufferedBytes` is dropped, never buffered
 * further; the heartbeat comment both keeps proxies open and detects dead sockets.
 */
import type { ServerResponse } from 'node:http';
import type { SseLimits } from '../config';
import { ApiError } from '../http/errors';
import { toJson } from '../http/json';
import { SECURITY_HEADERS } from '../http/security';

interface Client {
  res: ServerResponse;
  channel: string;
  ip: string;
  openedAt: number;
}

export const DEFAULT_SSE_LIMITS: SseLimits = {
  maxConnections: 500,
  maxPerIp: 8,
  maxPerChannel: 100,
  maxAgeMs: 30 * 60_000,
  heartbeatMs: 15_000,
  maxBufferedBytes: 256 * 1024,
};

export class SseHub {
  private readonly channels = new Map<string, Set<Client>>();
  private readonly perIp = new Map<string, number>();
  private total = 0;
  private seq = 0;
  private readonly timer: NodeJS.Timeout;
  dropped = 0;

  constructor(
    readonly limits: SseLimits = DEFAULT_SSE_LIMITS,
    private readonly now: () => number = Date.now,
  ) {
    this.timer = setInterval(() => this.heartbeat(), limits.heartbeatMs);
    this.timer.unref();
  }

  static userChannel(address: string) {
    return `user:${address.toLowerCase()}`;
  }
  static venueChannel(venue: string) {
    return `venue:${venue.toLowerCase()}`;
  }

  /** Throws TOO_MANY_CONNECTIONS when a cap is reached. Call BEFORE hijacking the reply. */
  admit(channel: string, ip: string): void {
    const l = this.limits;
    if (this.total >= l.maxConnections) throw new ApiError('TOO_MANY_CONNECTIONS', { details: { scope: 'global' } });
    if ((this.perIp.get(ip) ?? 0) >= l.maxPerIp) throw new ApiError('TOO_MANY_CONNECTIONS', { details: { scope: 'client' } });
    if ((this.channels.get(channel)?.size ?? 0) >= l.maxPerChannel) throw new ApiError('TOO_MANY_CONNECTIONS', { details: { scope: 'channel' } });
  }

  /** Takes over a raw response: writes headers and keeps it until the client disconnects (or is dropped). */
  attach(channel: string, res: ServerResponse, opts: { origin?: string | undefined; ip: string }): () => void {
    this.admit(channel, opts.ip);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      ...(opts.origin ? { 'access-control-allow-origin': opts.origin, vary: 'Origin' } : {}),
    });
    const client: Client = { res, channel, ip: opts.ip, openedAt: this.now() };
    let set = this.channels.get(channel);
    if (!set) this.channels.set(channel, (set = new Set()));
    set.add(client);
    this.total++;
    this.perIp.set(opts.ip, (this.perIp.get(opts.ip) ?? 0) + 1);
    let detached = false;
    const detach = () => {
      if (detached) return;
      detached = true;
      set!.delete(client);
      if (set!.size === 0) this.channels.delete(channel);
      this.total--;
      const n = (this.perIp.get(opts.ip) ?? 1) - 1;
      if (n <= 0) this.perIp.delete(opts.ip);
      else this.perIp.set(opts.ip, n);
    };
    res.on('close', detach);
    res.on('error', detach);
    this.write(client, `retry: 3000\n: connected ${channel}\n\n`);
    return detach;
  }

  /** Write or drop: never keep buffering for a client that can't keep up. */
  private write(c: Client, frame: string): void {
    if (c.res.destroyed || c.res.writableEnded) return;
    if (c.res.writableLength > this.limits.maxBufferedBytes) return this.drop(c);
    const ok = c.res.write(frame);
    if (!ok) this.drop(c);
  }

  private drop(c: Client) {
    this.dropped++;
    c.res.destroy();
  }

  publish(channel: string, event: string, data: unknown): number {
    const set = this.channels.get(channel.toLowerCase());
    if (!set || set.size === 0) return 0;
    const frame = `id: ${++this.seq}\nevent: ${event}\ndata: ${JSON.stringify(toJson(data))}\n\n`;
    for (const c of [...set]) this.write(c, frame);
    return set.size;
  }

  count(channel?: string): number {
    if (channel) return this.channels.get(channel.toLowerCase())?.size ?? 0;
    return this.total;
  }

  /** Heartbeat + max-age sweep (exposed for tests). */
  heartbeat() {
    const t = this.now();
    for (const set of this.channels.values()) {
      for (const c of [...set]) {
        if (t - c.openedAt >= this.limits.maxAgeMs) c.res.end();
        else this.write(c, ': ping\n\n');
      }
    }
  }

  close() {
    clearInterval(this.timer);
    for (const set of this.channels.values()) for (const c of set) c.res.end();
    this.channels.clear();
    this.perIp.clear();
    this.total = 0;
  }
}
