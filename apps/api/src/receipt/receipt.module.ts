import { Module } from '@nestjs/common';
import { CategoryModule } from '../category/category.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AnthropicExtractionProvider } from './extraction/anthropic-extraction.provider';
import { extractionProviderFactory } from './extraction/extraction-provider.factory';
import { MockExtractionProvider } from './extraction/mock-extraction.provider';
import { OpenAiExtractionProvider } from './extraction/openai-extraction.provider';
import { MerchantController } from './merchant.controller';
import { ReceiptExtractionProcessor } from './receipt-extraction.processor';
import { ReceiptStorageService } from './receipt-storage.service';
import { ReceiptController } from './receipt.controller';
import { ReceiptService } from './receipt.service';

/**
 * Phase 7 — Receipt Ingestion & LLM Extraction module.
 *
 * 7.3 storage + 7.4 CRUD/producer surface. The extraction provider layer
 * (7.5) and the queue consumer (7.6) land next; the `RECEIPT_EXTRACTIONS_QUEUE`
 * itself comes from the global `QueueModule`, so no extra import here.
 */
@Module({
  imports: [PrismaModule, RealtimeModule, CategoryModule],
  providers: [
    ReceiptService,
    ReceiptStorageService,
    MockExtractionProvider,
    AnthropicExtractionProvider,
    OpenAiExtractionProvider,
    extractionProviderFactory,
    ReceiptExtractionProcessor,
  ],
  controllers: [ReceiptController, MerchantController],
  exports: [ReceiptService, ReceiptStorageService, extractionProviderFactory],
})
export class ReceiptModule {}
