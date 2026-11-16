import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { APP_NAME, ARC_TESTNET_CHAIN_ID } from '@vouch/shared';
import { loadEnv, type ApiEnv } from './env';
import { createDb, type DbHandle } from './db/index';
import { webhookRoutes } from './routes/webhooks';

export interface BuiltApp {
  app: FastifyInstance;
  db: DbHandle;
  env: ApiEnv;
}

export async function buildApp(overrides: Partial<ApiEnv> = {}, opts: { logger?: boolean } = {}): Promise<BuiltApp> {
  const env = loadEnv(overrides);
  const db = createDb(env.databaseUrl);
  await db.migrate();

  const app = Fastify({ logger: opts.logger ?? true });
  await app.register(cors, { origin: env.corsOrigins });

  app.get('/health', async () => ({
    ok: true,
    app: APP_NAME,
    chainId: ARC_TESTNET_CHAIN_ID,
    db: { kind: db.kind, ok: await db.ping().catch(() => false) },
    time: new Date().toISOString(),
  }));

  await app.register(webhookRoutes, { logFile: env.streamsSpikeLog, secret: env.streamsWebhookSecret });

  app.addHook('onClose', async () => {
    await db.close();
  });

  return { app, db, env };
}
