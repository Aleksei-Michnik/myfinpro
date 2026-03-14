/// <reference types="node" />
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Phase 0: Verify database connection
  await prisma.$connect();
  console.log('✅ Database connection verified');

  // Phase 1: Create development test user
  // Password: "TestPass123" — hashed with Argon2id (will be updated when auth service is available)
  // For now, use a placeholder hash. The actual hashing will be done in iteration 1.2+1.3
  const devUser = await prisma.user.upsert({
    where: { email: 'dev@myfinpro.test' },
    update: {},
    create: {
      email: 'dev@myfinpro.test',
      name: 'Dev User',
      defaultCurrency: 'USD',
      locale: 'en',
      timezone: 'UTC',
      isActive: true,
      emailVerified: true,
      // passwordHash will be set in iteration 1.2+1.3 when Argon2 is available
    },
  });

  console.log(`✅ Dev user created/verified: ${devUser.email} (id: ${devUser.id})`);

  console.log('🌱 Seed completed successfully');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
