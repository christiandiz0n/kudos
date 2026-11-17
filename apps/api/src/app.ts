import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { APP_NAME, ARC_TESTNET_CHAIN_ID } from '@vouch/shared';
import { loadEnv, type ApiEnv } from './env';
import { createDb, type DbHandle } from './db/index';
import { webhookRoutes } from './routes/webhooks';
import { insertDelivery } from './streams/deliveries';
import { createStreams, type Streams } from './streams/index';
import { apiRoutes } from './routes/api';
import { createApiDeps, type ApiDeps, type ApiDepsOverrides } from './services';
import { applySecurity, corsOptions, fastifyOptions } from './http/security';

export interface BuiltApp {
  app: FastifyInstance;
  db: DbHandle;
  env: ApiEnv;
  /** Streams-derived state: StreamsPort (queries + bus) + ingest (STREAMS_INFRA, D-306). */
  streams: Streams;
  /** BACKEND_RELAYER services (relayer, sessions, signers, SSE). */
  deps: ApiDeps;
}

export async function buildApp(overrides: Partial<ApiEnv> = {}, opts: { logger?: boolean | { stream: NodeJS.WritableStream }; api?: ApiDepsOverrides } = {}): Promise<BuiltApp> {
  const env = loadEnv(overrides);
  const db = createDb(env.databaseUrl);
  await db.migrate();

  // Redacting log serializers, Railway-range trustProxy, security headers, standard 404 (BACKEND_RELAYER, D-809).
  const app = Fastify(fastifyOptions(opts.logger ?? true));
  applySecurity(app);
  const streams = createStreams(db, { log: app.log });
  // Catch up deliveries stored but not ingested (crash between raw insert and ingest, or earlier ingest failures).
  await streams.ingestPending({ emit: false }).catch((err) => app.log.error({ err: (err as Error).message }, 'streams ingestPending failed'));
  await app.register(cors, corsOptions(env.corsOrigins));

  app.get('/health', async () => ({
    ok: true,
    app: APP_NAME,
    chainId: ARC_TESTNET_CHAIN_ID,
    db: { kind: db.kind, ok: await db.ping().catch(() => false) },
    time: new Date().toISOString(),
  }));

  await app.register(webhookRoutes, {
    logFile: env.streamsSpikeLog,
    secret: env.streamsWebhookSecret,
    store: (row) => insertDelivery(db, row),
    ingest: async (rowId, body) => {
      const r = await streams.ingestDelivery(rowId, body);
      await streams.retryFailed();
      return r;
    },
  });

  // BACKEND_RELAYER routes (auth, venues, orders, intros, payments, reads, SSE); "settled" reads go through `streams`.
  const deps = createApiDeps(db, streams, opts.api, (msg, extra) => app.log.info(extra ?? {}, msg));
  await app.register(apiRoutes, { deps, corsOrigins: env.corsOrigins });

  app.addHook('onClose', async () => {
    await db.close();
  });

  return { app, db, env, streams, deps };
}
