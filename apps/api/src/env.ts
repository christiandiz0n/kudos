import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Repo root, resolved from this file (apps/api/src/env.ts). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface ApiEnv {
  port: number;
  host: string;
  databaseUrl: string;
  corsOrigins: string[];
  streamsSpikeLog: string;
  streamsWebhookSecret: string | undefined;
}

export function loadEnv(overrides: Partial<ApiEnv> = {}): ApiEnv {
  const e = process.env;
  return {
    port: Number(e.API_PORT ?? 4000),
    host: e.API_HOST ?? '0.0.0.0',
    databaseUrl: e.DATABASE_URL || 'pglite://./data/local/pglite',
    corsOrigins: (e.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean),
    streamsSpikeLog: e.STREAMS_SPIKE_LOG ?? path.join(REPO_ROOT, 'data/local/streams-spike.ndjson'),
    streamsWebhookSecret: e.STREAMS_WEBHOOK_SECRET || undefined,
    ...overrides,
  };
}
