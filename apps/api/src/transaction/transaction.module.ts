import { Module } from '@nestjs/common';
import { CategoryModule } from '../category/category.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SystemCategoriesBootstrap } from './system-categories.bootstrap';
import { TransactionCommentController } from './transaction-comment.controller';
import { TransactionCommentService } from './transaction-comment.service';
import { TransactionOccurrenceProcessor } from './transaction-occurrence.processor';
import { TransactionPlanController } from './transaction-plan.controller';
import { TransactionPlanService } from './transaction-plan.service';
import { TransactionScheduleController } from './transaction-schedule.controller';
import { TransactionScheduleService } from './transaction-schedule.service';
import { TransactionController } from './transaction.controller';
import { TransactionService } from './transaction.service';

/**
 * Phase 6 — Transaction Management module.
 *
 * Exposes the transactions CRUD endpoints (create / list / get / update / delete,
 * star toggle), the iteration 6.10 comments sub-resource, and the iteration
 * 6.17.2 schedule CRUD sub-resource. The system-categories bootstrap from
 * 6.3 is still hosted here.
 *
 * The schedule producer (`TransactionScheduleService`) and the no-op processor
 * placeholder (`TransactionOccurrenceProcessor`, real worker lands in 6.17.3)
 * both rely on the global `QueueModule` which exposes the
 * `TRANSACTION_OCCURRENCES_QUEUE`. Because `QueueModule` is `@Global()`, no
 * extra imports are needed here.
 */
@Module({
  imports: [PrismaModule, CategoryModule, RealtimeModule],
  providers: [
    TransactionService,
    TransactionCommentService,
    TransactionPlanService,
    TransactionScheduleService,
    TransactionOccurrenceProcessor,
    SystemCategoriesBootstrap,
  ],
  controllers: [
    TransactionController,
    TransactionCommentController,
    TransactionPlanController,
    TransactionScheduleController,
  ],
  exports: [
    TransactionService,
    TransactionCommentService,
    TransactionPlanService,
    TransactionScheduleService,
  ],
})
export class TransactionModule {}
