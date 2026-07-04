import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
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
  imports: [PrismaModule, RealtimeModule],
  providers: [ReceiptService, ReceiptStorageService],
  controllers: [ReceiptController],
  exports: [ReceiptService, ReceiptStorageService],
})
export class ReceiptModule {}
