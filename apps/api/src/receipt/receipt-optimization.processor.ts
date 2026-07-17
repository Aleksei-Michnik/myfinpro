import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { RECEIPT_OPTIMIZATIONS_QUEUE } from '../queue/queue.constants';
import {
  ReceiptOptimizationService,
  type ReceiptOptimizationJob,
} from './receipt-optimization.service';

/** Phase 8.25 — receipt storage compaction worker (design §3.6). */
@Processor(RECEIPT_OPTIMIZATIONS_QUEUE)
export class ReceiptOptimizationProcessor extends WorkerHost {
  constructor(private readonly optimizations: ReceiptOptimizationService) {
    super();
  }

  async process(job: Job<ReceiptOptimizationJob>): Promise<{ optimized: number }> {
    return this.optimizations.optimize(job.data.receiptId);
  }
}
