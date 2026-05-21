import { Module } from '@nestjs/common';
import { CategoryModule } from '../category/category.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PaymentCommentController } from './payment-comment.controller';
import { PaymentCommentService } from './payment-comment.service';
import { PaymentOccurrenceProcessor } from './payment-occurrence.processor';
import { PaymentScheduleController } from './payment-schedule.controller';
import { PaymentScheduleService } from './payment-schedule.service';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { SystemCategoriesBootstrap } from './system-categories.bootstrap';

/**
 * Phase 6 — Payment Management module.
 *
 * Exposes the payments CRUD endpoints (create / list / get / update / delete,
 * star toggle), the iteration 6.10 comments sub-resource, and the iteration
 * 6.17.2 schedule CRUD sub-resource. The system-categories bootstrap from
 * 6.3 is still hosted here.
 *
 * The schedule producer (`PaymentScheduleService`) and the no-op processor
 * placeholder (`PaymentOccurrenceProcessor`, real worker lands in 6.17.3)
 * both rely on the global `QueueModule` which exposes the
 * `PAYMENT_OCCURRENCES_QUEUE`. Because `QueueModule` is `@Global()`, no
 * extra imports are needed here.
 */
@Module({
  imports: [PrismaModule, CategoryModule, RealtimeModule],
  providers: [
    PaymentService,
    PaymentCommentService,
    PaymentScheduleService,
    PaymentOccurrenceProcessor,
    SystemCategoriesBootstrap,
  ],
  controllers: [PaymentController, PaymentCommentController, PaymentScheduleController],
  exports: [PaymentService, PaymentCommentService, PaymentScheduleService],
})
export class PaymentModule {}
