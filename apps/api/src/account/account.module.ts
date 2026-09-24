import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

/**
 * Phase 20 — Accounts, Balances & Bank Sync module.
 *
 * Iteration 20.2 exposes the accounts CRUD + archive endpoints with the
 * budgets scope/role matrix (design §2.1), derived ledger balances (§2.2),
 * audit logging and the advisory `account.updated` realtime event. Statement
 * imports, the review queue and the matcher (§5, §6.2) ship in 20.4.
 */
@Module({
  imports: [PrismaModule, RealtimeModule],
  providers: [AccountService],
  controllers: [AccountController],
  exports: [AccountService],
})
export class AccountModule {}
