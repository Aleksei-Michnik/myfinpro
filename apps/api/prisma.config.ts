import path from 'node:path';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  datasource: {
    // Use DATABASE_URL from environment. Falls back to a placeholder
    // for operations like `prisma generate` that don't need a real connection.
    url: process.env.DATABASE_URL ?? 'mysql://placeholder:placeholder@localhost:3306/placeholder',
  },
  migrations: {
    seed: 'npx ts-node prisma/seed.ts',
  },
});
