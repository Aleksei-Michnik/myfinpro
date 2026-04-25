import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SystemCategoriesBootstrap } from './system-categories.bootstrap';

/**
 * Phase 6 — Payment Management module.
 *
 * Iteration 6.3: ships only the system-categories bootstrap. Controllers
 * and services for payments/categories are added in iterations 6.4+.
 */
@Module({
  imports: [PrismaModule],
  providers: [SystemCategoriesBootstrap],
})
export class PaymentModule {}
