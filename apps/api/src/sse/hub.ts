/**
 * SSE fan-out. Channels: `user:<address>` and `venue:<venue>` (lowercase). The relayer pushes "pending"/"failed";
 * STREAMS_INFRA's bus pushes "settled" (payment.settled, reward.paid, intro.accepted, customer.verified, …).
 * Each message: `id: <seq>\nevent: <type>\ndata: <json>\n\n`. A comment heartbeat keeps proxies from closing idle
 * connections (Railway/edge timeouts).
 */
import type { ServerResponse } from 'node:http';
import { toJson } from '../http/json';

export interface SseClient {
  res: ServerResponse;
  channel: string;
}

export class SseHub {
  private readonly channels = new Map<string, Set<ServerResponse>>();
  private seq = 0;
  private readonly timer: NodeJS.Timeout;

  constructor(heartbeatMs = 15_000) {
    this.timer = setInterval(() => this.heartbeat(), heartbeatMs);
    this.timer.unref();
  }

  static userChannel(address: string) {
    return `user:${address.toLowerCase()}`;
  }
  static venueChannel(venue: string) {
    return `venue:${venue.toLowerCase()}`;
  }

  /** Takes over a raw response: writes headers and keeps it until the client disconnects. */
  attach(channel: string, res: ServerResponse, origin?: string): () => void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
    });
    res.write(`retry: 3000\n: connected ${channel}\n\n`);
    let set = this.channels.get(channel);
    if (!set) this.channels.set(channel, (set = new Set()));
    set.add(res);
    const detach = () => {
      set!.delete(res);
      if (set!.size === 0) this.channels.delete(channel);
    };
    res.on('close', detach);
    return detach;
  }

  publish(channel: string, event: string, data: unknown): number {
    const set = this.channels.get(channel.toLowerCase());
    if (!set || set.size === 0) return 0;
    const frame = `id: ${++this.seq}\nevent: ${event}\ndata: ${JSON.stringify(toJson(data))}\n\n`;
    for (const res of set) res.write(frame);
    return set.size;
  }

  count(channel?: string): number {
    if (channel) return this.channels.get(channel.toLowerCase())?.size ?? 0;
    let n = 0;
    for (const s of this.channels.values()) n += s.size;
    return n;
  }

  private heartbeat() {
    for (const set of this.channels.values()) for (const res of set) res.write(': ping\n\n');
  }

  close() {
    clearInterval(this.timer);
    for (const set of this.channels.values()) for (const res of set) res.end();
    this.channels.clear();
  }
}
