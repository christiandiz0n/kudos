import { defineConfig } from 'drizzle-kit';

/**
 * STREAMS_INFRA's derived tables (ev_*), kept apart from BACKEND_RELAYER's `./drizzle` journal so parallel
 * `drizzle-kit generate` runs never collide. Runtime: `db.migrate()` applies `./drizzle` then `./drizzle-streams`
 * (migrations table `drizzle.__drizzle_migrations_streams`).
 *   pnpm --filter @vouch/api db:generate:streams --name <change>
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/streams/schema.ts',
  out: './drizzle-streams',
  migrations: { table: '__drizzle_migrations_streams', schema: 'drizzle' },
});
