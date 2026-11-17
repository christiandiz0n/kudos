/**
 * SSE channels: GET /events/user/:address (session required, own address only; `?token=` for EventSource) and
 * GET /events/venue/:venue (public: venue activity is public on-chain anyway). "pending"/"failed" are pushed by the
 * relay routes; everything "settled" is fanned out here from STREAMS_INFRA's bus.
 */
import type { FastifyInstance } from 'fastify';
import { zeroAddress } from 'viem';
import { ApiError } from '../http/errors';
import { sseTokenFrom } from '../auth/session';
import { addr, sameAddr } from '../http/json';
import type { IngestedEvent } from '../ports/streams';
import { SseHub } from '../sse/hub';
import { type Ctx } from './common';
import { lineView, settledView } from './views';

export function fanOut(sse: SseHub, e: IngestedEvent) {
  const u = (a: string) => SseHub.userChannel(a);
  const v = (a: string) => SseHub.venueChannel(a);
  switch (e.type) {
    case 'payment.settled': {
      const p = settledView(e.payment);
      sse.publish(u(e.payment.customer), 'payment.settled', p);
      sse.publish(v(e.payment.venue), 'payment.settled', p);
      for (const l of e.payment.lines) {
        if (l.returned || l.recipient === zeroAddress) continue;
        sse.publish(u(l.recipient), 'reward.paid', lineView(l));
      }
      return;
    }
    case 'intro.accepted':
      sse.publish(u(e.intro.customer), 'intro.accepted', e.intro);
      sse.publish(u(e.intro.referrer), 'intro.accepted', e.intro);
      sse.publish(v(e.intro.venue), 'intro.accepted', e.intro);
      return;
    case 'intro.dropped':
      sse.publish(u(e.customer), 'intro.dropped', e);
      sse.publish(u(e.referrer), 'intro.dropped', e);
      return;
    case 'customer.verified':
      sse.publish(u(e.customer), 'customer.verified', e);
      sse.publish(v(e.venue), 'customer.verified', e);
      return;
    case 'venue.registered':
      sse.publish(u(e.owner), 'venue.registered', e);
      sse.publish(v(e.venue), 'venue.registered', e);
      return;
    case 'terms.updated':
      sse.publish(v(e.venue), 'terms.updated', e);
      return;
    case 'venue.keys':
      sse.publish(v(e.venue), 'venue.keys', e);
      return;
    case 'seed.set':
      sse.publish(v(e.venue), 'seed.set', e);
      sse.publish(u(e.ambassador), 'seed.set', e);
      return;
  }
}

export function registerEventRoutes(app: FastifyInstance, ctx: Ctx, corsOrigins: string[]) {
  const { deps } = ctx;
  const unsub = deps.streams.bus.subscribe((e) => {
    try {
      fanOut(deps.sse, e);
    } catch (err) {
      deps.log('sse fan-out failed', { err: String(err) });
    }
  });
  app.addHook('onClose', async () => {
    unsub();
    deps.sse.close();
  });

  // hijacked replies bypass @fastify/cors, so echo an allowed Origin ourselves.
  const origin = (o: string | string[] | undefined) => (typeof o === 'string' && (corsOrigins.includes('*') || corsOrigins.includes(o)) ? o : undefined);

  app.get('/events/user/:address', async (req, reply) => {
    const address = addr((req.params as { address: string }).address, 'address');
    // The only route that accepts ?token= (EventSource cannot send headers); logs redact it (SEC-2-03).
    const c = await deps.sessions.authenticate(sseTokenFrom(req));
    if (!c) throw new ApiError('UNAUTHENTICATED');
    if (!sameAddr(c.sub, address)) throw new ApiError('FORBIDDEN');
    const channel = SseHub.userChannel(address);
    const ip = ctx.ipKey(req);
    deps.sse.admit(channel, ip);
    reply.hijack();
    deps.sse.attach(channel, reply.raw, { origin: origin(req.headers.origin), ip });
  });

  app.get('/events/venue/:venue', async (req, reply) => {
    const venue = addr((req.params as { venue: string }).venue, 'venue');
    const channel = SseHub.venueChannel(venue);
    const ip = ctx.ipKey(req);
    deps.sse.admit(channel, ip);
    // Only known venues get a channel (SEC-2-06): Streams-derived, then the chain.
    const known = (await deps.streams.getVenue(venue)) !== null || (await deps.chain.getVenue(venue)).owner !== zeroAddress;
    if (!known) throw new ApiError('UNKNOWN_VENUE');
    reply.hijack();
    deps.sse.attach(channel, reply.raw, { origin: origin(req.headers.origin), ip });
  });
}
