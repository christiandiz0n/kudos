import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { REPO_ROOT } from '../env';
import * as schema from './schema';

export const MIGRATIONS_FOLDER = path.join(REPO_ROOT, 'apps/api/drizzle');
/** STREAMS_INFRA derived tables (ev_*): own folder + own migrations table, applied after MIGRATIONS_FOLDER (Phase 2). */
export const STREAMS_MIGRATIONS = { migrationsFolder: path.join(REPO_ROOT, 'apps/api/drizzle-streams'), migrationsTable: '__drizzle_migrations_streams' };

/**
 * DATABASE_URL switch (D-203):
 *   postgres:// | postgresql://  -> hosted Postgres via postgres-js
 *   pglite://memory              -> in-memory PGlite (tests)
 *   pglite://<path> or empty     -> on-disk PGlite (local dev), path relative to repo root
 */
export type DbKind = 'postgres' | 'pglite';

export interface DbHandle {
  kind: DbKind;
  /** Drizzle instance. Both drivers share the pg-core query builder API. */
  db: ReturnType<typeof drizzlePglite<typeof schema>> | ReturnType<typeof drizzlePostgres<typeof schema>>;
  migrate(): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export function createDb(databaseUrl: string): DbHandle {
  if (/^postgres(ql)?:\/\//.test(databaseUrl)) {
    const client = postgres(databaseUrl, { max: 5 });
    const db = drizzlePostgres({ client, schema });
    return {
      kind: 'postgres',
      db,
      migrate: async () => {
        await migratePostgres(db, { migrationsFolder: MIGRATIONS_FOLDER });
        await migratePostgres(db, STREAMS_MIGRATIONS);
      },
      ping: async () => (await db.execute(sql`select 1 as ok`)).length === 1,
      close: () => client.end(),
    };
  }

  const target = databaseUrl.replace(/^pglite:\/\//, '') || './data/local/pglite';
  let client: PGlite;
  if (target === 'memory') {
    client = new PGlite();
  } else {
    const dir = path.resolve(REPO_ROOT, target);
    mkdirSync(dir, { recursive: true });
    client = new PGlite(dir);
  }
  const db = drizzlePglite({ client, schema });
  return {
    kind: 'pglite',
    db,
    migrate: async () => {
      await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
      await migratePglite(db, STREAMS_MIGRATIONS);
    },
    ping: async () => (await db.execute(sql`select 1 as ok`)).rows.length === 1,
    close: () => client.close(),
  };
}
