import { Module } from '@nestjs/common';
import { CategoryModule } from '../category/category.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { SystemCategoriesBootstrap } from './system-categories.bootstrap';

/**
 * Phase 6 — Payment Management module.
 *
 * Iteration 6.5: exposes POST /payments (ONE_TIME only) via PaymentService
 * + PaymentController. Still hosts the system-categories bootstrap from 6.3.
 * Later iterations (6.6 list, 6.7 get, 6.8 patch/delete, 6.14 comments,
 * 6.15 stars, 6.16 docs, 6.17 schedules, 6.19 plans) extend this module.
 */
@Module({
  imports: [PrismaModule, CategoryModule],
  providers: [PaymentService, SystemCategoriesBootstrap],
  controllers: [PaymentController],
  exports: [PaymentService],
})
export class PaymentModule {}
