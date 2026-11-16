import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Repo root, resolved from this file (apps/api/src/env.ts). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface ApiEnv {
  /** `PORT` (injected by hosts like Railway) wins over `API_PORT` (local dev), default 4000. */
  port: number;
  host: string;
  databaseUrl: string;
  corsOrigins: string[];
  /** NDJSON spike log path, or null when disabled (`STREAMS_SPIKE_LOG=off`, or NODE_ENV=production without an explicit path). */
  streamsSpikeLog: string | null;
  streamsWebhookSecret: string | undefined;
}

/** Empty values and `.env.example` placeholders (`__like_this__`) count as unset, so the webhook fails closed. */
export function realSecret(v: string | undefined): string | undefined {
  if (!v || /^__.*__$/.test(v.trim())) return undefined;
  return v;
}

/** First non-empty value wins; must be an integer port in 1..65535. */
export function resolvePort(e: NodeJS.ProcessEnv = process.env): number {
  const raw = [e.PORT, e.API_PORT].map((v) => v?.trim()).find((v) => v) ?? '4000';
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`invalid PORT/API_PORT: ${JSON.stringify(raw)}`);
  return n;
}

/**
 * The NDJSON spike log is a local-dev aid. On a host (NODE_ENV=production) the container disk is ephemeral and the
 * Postgres `stream_deliveries` table is the record, so it is off unless STREAMS_SPIKE_LOG names a path explicitly.
 */
export function resolveSpikeLog(e: NodeJS.ProcessEnv = process.env): string | null {
  const v = e.STREAMS_SPIKE_LOG?.trim();
  if (v && /^(off|none|false|0)$/i.test(v)) return null;
  if (!v && e.NODE_ENV === 'production') return null;
  // Relative paths resolve against the repo root (same rule as scripts/streams/show-deliveries.ts, QE-06).
  return path.resolve(REPO_ROOT, v || 'data/local/streams-spike.ndjson');
}

export function loadEnv(overrides: Partial<ApiEnv> = {}): ApiEnv {
  const e = process.env;
  return {
    port: resolvePort(e),
    host: e.API_HOST ?? '0.0.0.0',
    databaseUrl: e.DATABASE_URL || 'pglite://./data/local/pglite',
    corsOrigins: (e.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean),
    streamsSpikeLog: resolveSpikeLog(e),
    streamsWebhookSecret: realSecret(e.STREAMS_WEBHOOK_SECRET),
    ...overrides,
  };
}
