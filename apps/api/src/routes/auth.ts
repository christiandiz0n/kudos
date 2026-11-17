import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { users, venuesMeta } from '../db/schema';
import { ApiError } from '../http/errors';
import { addr, obj, reqStr, sig, str } from '../http/json';
import { send, type Ctx } from './common';

export function registerAuthRoutes(app: FastifyInstance, ctx: Ctx) {
  const { deps } = ctx;
  const db = deps.handle.db;

  app.post('/auth/challenge', async (req, reply) => {
    const b = obj(req.body);
    const address = addr(b.address, 'address');
    return send(reply, 200, await deps.sessions.challenge(address));
  });

  app.post('/auth/verify', async (req, reply) => {
    const b = obj(req.body);
    const out = await deps.sessions.verify({
      address: addr(b.address, 'address'),
      challengeId: reqStr(b.challengeId, 'challengeId', 64),
      signature: sig(b.signature),
      displayName: str(b.displayName, 'displayName', 60, { optional: true }),
      passkeyCredentialId: str(b.passkeyCredentialId, 'passkeyCredentialId', 512, { optional: true }),
      userAgent: req.headers['user-agent'],
    });
    return send(reply, 200, out);
  });

  app.get('/auth/session', async (req, reply) => {
    const c = await ctx.auth(req);
    const [u] = await db.select().from(users).where(eq(users.address, c.sub)).limit(1);
    const venues = await db.select({ venue: venuesMeta.venue, name: venuesMeta.name, status: venuesMeta.status }).from(venuesMeta).where(eq(venuesMeta.owner, c.sub));
    return send(reply, 200, {
      address: c.sub,
      displayName: u?.displayName ?? null,
      expiresAt: new Date(c.exp * 1000).toISOString(),
      roles: { customer: true, venueOwner: venues.length > 0 },
      venues,
    });
  });

  app.post('/auth/logout', async (req, reply) => {
    const c = await ctx.auth(req);
    await deps.sessions.revoke(c.sid);
    return send(reply, 200, { ok: true });
  });

  app.patch('/me', async (req, reply) => {
    const c = await ctx.auth(req);
    const b = obj(req.body);
    const displayName = str(b.displayName, 'displayName', 60, { optional: true });
    if (displayName !== undefined) await db.update(users).set({ displayName }).where(eq(users.address, c.sub));
    return send(reply, 200, { address: c.sub, displayName: displayName ?? null });
  });
}
