import { Module } from '@nestjs/common';
import { FreshAuthGuard } from './guards/fresh-auth.guard';
import { LlmController } from './llm.controller';
import { LlmCredentialsService } from './llm-credentials.service';
import { LlmSettingsService } from './llm-settings.service';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Phase 8.11 — per-user LLM settings (runbook §9): curated model catalog,
 * per-user selection, and encrypted BYOK API keys. Imported by ReceiptModule,
 * whose extraction resolver consumes LlmCredentialsService — so this module
 * rides the receipt module's import into the app graph (same pattern as
 * ProductModule).
 */
@Module({
  imports: [PrismaModule],
  providers: [LlmCredentialsService, LlmSettingsService, FreshAuthGuard],
  controllers: [LlmController],
  exports: [LlmCredentialsService, LlmSettingsService],
})
export class LlmModule {}
