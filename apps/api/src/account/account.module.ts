import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TransactionModule } from '../transaction/transaction.module';
import { AccountImportController } from './account-import.controller';
import { AccountImportService } from './account-import.service';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { StatementAutoLinkService } from './matching/statement-auto-link.service';
import { StatementMatchingService } from './matching/statement-matching.service';
import { StatementLineController } from './statement-line.controller';
import { StatementLineService } from './statement-line.service';

/**
 * Phase 20 — Accounts, Balances & Bank Sync module.
 *
 * 20.2 exposed the accounts CRUD + archive endpoints with the budgets
 * scope/role matrix (design §2.1), derived ledger balances (§2.2), audit
 * logging and the advisory `account.updated` realtime event.
 *
 * 20.4 adds the statement imports (§6.2), the matcher (§5) and the review
 * queue. `TransactionModule` is imported for `TransactionService`: every
 * transaction a line decision creates or enriches goes through it, never
 * through a second write path. The dependency is one-way — the transaction
 * module only uses the account module's pure visibility helper.
 *
 * 20.6 closes the enrichment loop the other way (§5.5): the
 * `StatementAutoLinkService` listens on the realtime bus for the
 * transactions other modules commit and asks the matcher to take the single
 * pending bank line that confirms one. Listening — rather than being called
 * — is what keeps that dependency one-way.
 *
 * 20.7 imports `AuthModule` for `ApiTokenService`: `@UseGuards` instantiates
 * `JwtOrApiTokenGuard` in THIS module, so its dependency must resolve here.
 * That guard sits on `POST /imports` alone — every other route of this module
 * stays JWT-only (design §6.4).
 */
@Module({
  imports: [AuthModule, PrismaModule, RealtimeModule, TransactionModule],
  providers: [
    AccountService,
    AccountImportService,
    StatementLineService,
    StatementMatchingService,
    StatementAutoLinkService,
  ],
  controllers: [AccountController, AccountImportController, StatementLineController],
  exports: [AccountService],
})
export class AccountModule {}
