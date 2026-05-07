import { Module } from '@nestjs/common';
import { CategoryModule } from '../category/category.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentCommentController } from './payment-comment.controller';
import { PaymentCommentService } from './payment-comment.service';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { SystemCategoriesBootstrap } from './system-categories.bootstrap';

/**
 * Phase 6 — Payment Management module.
 *
 * Exposes the payments CRUD endpoints (create / list / get / update / delete,
 * star toggle) plus the iteration 6.10 comments sub-resource. System
 * categories bootstrap from 6.3 is still hosted here.
 */
@Module({
  imports: [PrismaModule, CategoryModule],
  providers: [PaymentService, PaymentCommentService, SystemCategoriesBootstrap],
  controllers: [PaymentController, PaymentCommentController],
  exports: [PaymentService, PaymentCommentService],
})
export class PaymentModule {}
