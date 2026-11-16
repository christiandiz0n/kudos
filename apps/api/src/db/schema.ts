import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Phase 0: a single trivial table proving migrations run on both PGlite (local/tests) and Postgres
 * (deploy). BACKEND_RELAYER owns the real schema (Phase 2).
 */
export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
