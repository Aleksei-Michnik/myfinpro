import path from 'node:path';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  datasource: {
    // Use DATABASE_URL from environment. Falls back to a placeholder
    // for operations like `prisma generate` that don't need a real connection.
    url: process.env.DATABASE_URL ?? 'mysql://placeholder:placeholder@localhost:3306/placeholder',
    // Scratch DB for `migrate diff --from-migrations` (schema ↔ migrations
    // sync checks); never holds data.
    shadowDatabaseUrl:
      process.env.SHADOW_DATABASE_URL ??
      (process.env.DATABASE_URL
        ? process.env.DATABASE_URL.replace(/\/[A-Za-z0-9_]+(\?|$)/, '/prisma_shadow$1')
        : undefined),
  },
  migrations: {
    // Node 26 strips types natively — the seed graph is erasable TS only.
    seed: 'node prisma/seed.ts',
  },
});
