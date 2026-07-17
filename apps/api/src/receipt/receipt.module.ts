import { Module } from '@nestjs/common';
import { CategoryModule } from '../category/category.module';
import { LlmModule } from '../llm/llm.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductModule } from '../product/product.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TransactionModule } from '../transaction/transaction.module';
import { extractionProviderFactory } from './extraction/extraction-provider.factory';
import { ExtractionResolverService } from './extraction/extraction-resolver.service';
import { MockExtractionProvider } from './extraction/mock-extraction.provider';
import { MerchantController } from './merchant.controller';
import { ReceiptExtractionProcessor } from './receipt-extraction.processor';
import { ReceiptOptimizationProcessor } from './receipt-optimization.processor';
import { ReceiptOptimizationService } from './receipt-optimization.service';
import { ReceiptStorageService } from './receipt-storage.service';
import { ReceiptController } from './receipt.controller';
import { ReceiptService } from './receipt.service';
import { TransactionReceiptController } from './transaction-receipt.controller';
import { PairzonProvider } from './url-intake/pairzon.provider';
import { ReceiptUrlIntakeService } from './url-intake/receipt-url-intake.service';
import { RECEIPT_URL_PROVIDERS } from './url-intake/receipt-url-provider.interface';

/**
 * Phase 7 — Receipt Ingestion & LLM Extraction module.
 *
 * 7.3 storage + 7.4 CRUD/producer surface. The extraction provider layer
 * (7.5) and the queue consumer (7.6) land next; the `RECEIPT_EXTRACTIONS_QUEUE`
 * itself comes from the global `QueueModule`, so no extra import here.
 *
 * Phase 8 imports ProductModule: the worker feeds the staged product
 * matcher and the walkthrough endpoints write to the global registry.
 *
 * Phase 8.11 imports LlmModule: ExtractionResolverService picks the
 * uploader's selected model + key (user's own or shared), with the factory
 * binding as the deployment default. The concrete Anthropic/OpenAI providers
 * are no longer DI-managed — the factory and the resolver construct them.
 */
@Module({
  imports: [
    PrismaModule,
    RealtimeModule,
    CategoryModule,
    TransactionModule,
    ProductModule,
    LlmModule,
  ],
  providers: [
    ReceiptService,
    ReceiptStorageService,
    // Phase 8.25 — post-CONFIRM storage compaction (design §3.6).
    ReceiptOptimizationService,
    ReceiptOptimizationProcessor,
    MockExtractionProvider,
    extractionProviderFactory,
    ExtractionResolverService,
    ReceiptExtractionProcessor,
    // Phase 8.17 — online-receipt URL intake: provider adapters (client-side
    // rendered SPAs → their JSON data endpoint) + generic fetch + egress
    // politeness + anonymized analysis logging.
    PairzonProvider,
    ReceiptUrlIntakeService,
    {
      provide: RECEIPT_URL_PROVIDERS,
      useFactory: (pairzon: PairzonProvider) => [pairzon],
      inject: [PairzonProvider],
    },
  ],
  controllers: [ReceiptController, TransactionReceiptController, MerchantController],
  exports: [ReceiptService, ReceiptStorageService, extractionProviderFactory],
})
export class ReceiptModule {}
