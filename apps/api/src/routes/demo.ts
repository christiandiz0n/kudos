/**
 * Demo top-up routes (D-811). Testnet only; the UI labels the button "Top up (testnet demo)".
 *   GET  /demo/topup  (session optional) → { enabled, eligible, amount, dailyRemaining, reason?, topup }
 *   POST /demo/topup  (Bearer; the session's own address) → 202 { status: "pending", amount, txHash, relayId }
 */
import type { FastifyInstance } from 'fastify';
import { send, type Ctx } from './common';

export function registerDemoRoutes(app: FastifyInstance, ctx: Ctx) {
  const { deps } = ctx;

  app.get('/demo/topup', async (req, reply) => {
    const c = await ctx.optionalAuth(req);
    return send(reply, 200, await deps.topup.eligibility(c?.sub ?? null));
  });

  app.post('/demo/topup', async (req, reply) => {
    const c = await ctx.auth(req);
    return send(reply, 202, await deps.topup.request(c.sub, ctx.ipKey(req)));
  });
}
