import { execSync } from 'child_process';

import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';

/**
 * Testcontainers helper for integration tests.
 * Spins up an isolated MySQL container per test suite.
 *
 * Usage:
 *   const { prisma, container } = await setupTestDatabase();
 *   // ... run tests ...
 *   await teardownTestDatabase(prisma, container);
 */

let container: StartedMySqlContainer;
let prisma: PrismaClient;

export async function setupTestDatabase(): Promise<{
  prisma: PrismaClient;
  container: StartedMySqlContainer;
  databaseUrl: string;
}> {
  // Start MySQL container
  container = await new MySqlContainer('mysql:8.4')
    .withDatabase('myfinpro_test')
    .withUsername('test_user')
    .withUserPassword('test_password')
    .withCommand([
      '--default-authentication-plugin=mysql_native_password',
      '--character-set-server=utf8mb4',
      '--collation-server=utf8mb4_unicode_ci',
    ])
    .start();

  const databaseUrl = container.getConnectionUri();

  // Run Prisma migrations against the test container
  execSync('npx prisma migrate deploy', {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
    cwd: __dirname + '/../../',
  });

  // Create Prisma client for tests using the driver adapter
  const adapter = new PrismaMariaDb(databaseUrl);
  prisma = new PrismaClient({ adapter });

  await prisma.$connect();

  return { prisma, container, databaseUrl };
}

export async function teardownTestDatabase(
  prismaClient: PrismaClient,
  mysqlContainer: StartedMySqlContainer,
): Promise<void> {
  await prismaClient.$disconnect();
  await mysqlContainer.stop();
}
