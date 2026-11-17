/**
 * BACKEND_RELAYER routes plugin (Phase 2). Registered once by `buildApp`. Its error handler and the per-route-class
 * rate limiter are scoped to this plugin (Fastify encapsulation), so the Streams webhook keeps its own behaviour.
 *
 * Route classes (per client IP per minute, D-809; spend-class routes are also limited per user + budgeted by the relayer):
 *   auth   /auth/challenge, /auth/verify
 *   spend  everything that enqueues a relayer job or writes venue registration/metadata
 *   sse    /events/*
 *   write  other POST/PATCH/DELETE
 *   read   GET
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { classifySendError } from '../chain/errors';
import type { RouteLimits } from '../config';
import { isApiError, ApiError } from '../http/errors';
import { errText } from '../http/redact';
import { RateLimiter } from '../relayer/rate-limit';
import { seedRelayerBudget, type ApiDeps } from '../services';
import { registerAuthRoutes } from './auth';
import { createCtx } from './common';
import { registerEventRoutes } from './events';
import { registerIntroRoutes } from './intros';
import { registerOrderRoutes } from './orders';
import { registerPaymentRoutes } from './payments';
import { registerReadRoutes } from './reads';
import { registerVenueRoutes } from './venues';

export interface ApiRoutesOptions {
  deps: ApiDeps;
  corsOrigins: string[];
}

export type RouteClass = keyof RouteLimits;

const SPEND_ROUTES = new Set([
  'POST /venues/prepare',
  'POST /venues',
  'PATCH /venues/:venue',
  'POST /venues/:venue/actions/:id',
  'POST /intros/:code/accept',
  'POST /payments',
]);

export function routeClass(method: string, route: string | undefined): RouteClass {
  const r = route ?? '';
  if (r.startsWith('/auth/challenge') || r.startsWith('/auth/verify')) return 'auth';
  if (r.startsWith('/events/')) return 'sse';
  if (SPEND_ROUTES.has(`${method} ${r}`)) return 'spend';
  if (method === 'GET' || method === 'HEAD') return 'read';
  return 'write';
}

export const apiRoutes: FastifyPluginAsync<ApiRoutesOptions> = async (app: FastifyInstance, opts) => {
  const ctx = createCtx(opts.deps);
  const limits = opts.deps.cfg.routeLimits;
  const limiters: Record<RouteClass, RateLimiter> = {
    auth: new RateLimiter(limits.auth),
    spend: new RateLimiter(limits.spend),
    write: new RateLimiter(limits.write),
    read: new RateLimiter(limits.read),
    sse: new RateLimiter(limits.sse),
  };

  // Restore the last 24 h of relayer spend so a restart does not reset the budget (D-808).
  await seedRelayerBudget(opts.deps).catch((e) => opts.deps.log('relayer budget seed failed', { err: errText(e) }));

  app.addHook('onRequest', async (req: FastifyRequest) => {
    const cls = routeClass(req.method, req.routeOptions.url);
    const key = ctx.ipKey(req);
    const l = limiters[cls];
    if (!l.take(key)) throw new ApiError('RATE_LIMITED', { details: { scope: cls, retryAfterMs: l.retryAfterMs(key) } });
  });

  app.setErrorHandler((err, req, reply) => {
    if (isApiError(err)) {
      if (err.status >= 500) req.log.warn({ code: err.code, details: err.details }, 'api error');
      return reply.code(err.status).send(err.toJSON());
    }
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.code(e.statusCode).send(new ApiError('BAD_REQUEST', { status: e.statusCode, message: e.statusCode === 413 ? 'Request body is too large' : 'Something in that request was not right.' }).toJSON());
    }
    // Raw errors are never echoed (they can carry the RPC URL, SEC-2-07); chain/RPC outages read as "relayer down".
    if (classifySendError(err) === 'transport') {
      req.log.warn({ err: errText(err) }, 'chain unreachable');
      return reply.code(503).send(new ApiError('RELAYER_DOWN').toJSON());
    }
    req.log.error({ err: errText(err) }, 'unhandled api error');
    return reply.code(500).send(new ApiError('INTERNAL').toJSON());
  });

  registerAuthRoutes(app, ctx);
  registerVenueRoutes(app, ctx);
  registerOrderRoutes(app, ctx);
  registerIntroRoutes(app, ctx);
  registerPaymentRoutes(app, ctx);
  registerReadRoutes(app, ctx);
  registerEventRoutes(app, ctx, opts.corsOrigins);
};
