import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { BudgetController } from './budget.controller';
import { BudgetService } from './budget.service';

/**
 * Phase 10 — Budgets & Spending Targets module.
 *
 * Iteration 10.2 exposes the budgets CRUD + archive endpoints with the
 * scope/role guard matrix (design §2.3/§5), audit logging, and the
 * advisory `budget.updated` realtime event. Progress computation (10.5)
 * and the alert worker (10.9) land in later iterations.
 */
@Module({
  imports: [PrismaModule, RealtimeModule],
  providers: [BudgetService],
  controllers: [BudgetController],
  exports: [BudgetService],
})
export class BudgetModule {}
