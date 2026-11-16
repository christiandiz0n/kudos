/**
 * BACKEND_RELAYER routes plugin (Phase 2). Registered once by `buildApp`. Its error handler is scoped to this plugin
 * (Fastify encapsulation), so the Streams webhook keeps its own responses.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { isApiError, ApiError } from '../http/errors';
import type { ApiDeps } from '../services';
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

export const apiRoutes: FastifyPluginAsync<ApiRoutesOptions> = async (app: FastifyInstance, opts) => {
  const ctx = createCtx(opts.deps);

  app.setErrorHandler((err, req, reply) => {
    if (isApiError(err)) {
      if (err.status >= 500) req.log.warn({ code: err.code, details: err.details }, 'api error');
      return reply.code(err.status).send(err.toJSON());
    }
    const e = err as { statusCode?: number; validation?: unknown; message?: string };
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.code(e.statusCode).send(new ApiError('BAD_REQUEST', { status: e.statusCode, message: e.message }).toJSON());
    }
    req.log.error({ err }, 'unhandled api error');
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
