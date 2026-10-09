import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { seedSystemCategories } from './seed-system-categories';

/**
 * Ensures the system-owned default categories exist on every API boot.
 *
 * The deploy script only runs `prisma migrate deploy`, not `prisma db seed`,
 * so this module-init hook is the sole guarantee that the 26 defaults are
 * present on staging and production. It is fully idempotent (upsert by
 * slug+direction under owner_type='system').
 *
 * Skipped when NODE_ENV=test so unit/integration tests own their fixtures.
 */
@Injectable()
export class SystemCategoriesBootstrap implements OnModuleInit {
  private readonly logger = new Logger(SystemCategoriesBootstrap.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    try {
      const results = await seedSystemCategories(this.prisma);
      this.logger.log(`System categories ensured (${results.size} defaults).`);
    } catch (err) {
      // Never break application boot over a seed failure — log and continue.
      // Cause in the message, stack as the second argument: the nestjs-pino
      // bridge hands an Error passed after the message to pino as a printf
      // argument, which pino drops — production logged no cause at all.
      const error = err as Error;
      this.logger.error(`Failed to seed system categories on boot: ${error.message}`, error.stack);
    }
  }
}
