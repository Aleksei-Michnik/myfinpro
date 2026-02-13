import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

const adapter = new PrismaMariaDb(process.env.DATABASE_URL ?? '');
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Starting database seed...');

  // Phase 0: Verify database connection
  await prisma.$connect();
  console.log('✅ Database connection verified');

  // Create a test user to verify Prisma works
  const testUser = await prisma.user.upsert({
    where: { email: 'test@myfinpro.dev' },
    update: {},
    create: {
      email: 'test@myfinpro.dev',
    },
  });

  console.log(`✅ Test user created/verified: ${testUser.email} (id: ${testUser.id})`);

  // Seed data will be added as models are created in later phases.
  // Phase 1 will add: default user accounts for development
  // Phase 4 will add: sample groups and memberships
  // Phase 5 will add: sample income categories
  // Phase 6 will add: sample expense categories

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
