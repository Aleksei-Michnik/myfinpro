import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PAYMENT_OCCURRENCES_QUEUE } from '../queue/queue.constants';

/**
 * Phase 6, iteration 6.17.2 — **no-op** processor placeholder.
 *
 * Real occurrence creation lives in iteration 6.17.3. We register the
 * processor in 6.17.2 so jobs fired by `Queue.upsertJobScheduler` are
 * acknowledged (not stuck in the wait queue) during this transition
 * iteration. The no-op also gives us a log line that smoke tests + the
 * staging integration spec can grep for to prove the wiring works.
 *
 * Job options use `attempts: 1` (set by the producer in
 * [`PaymentScheduleService`](apps/api/src/payment/payment-schedule.service.ts:1))
 * so a misbehaving processor never retries endlessly during the rollout.
 */
@Processor(PAYMENT_OCCURRENCES_QUEUE)
export class PaymentOccurrenceProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentOccurrenceProcessor.name);

  async process(job: Job<{ scheduleId: string; paymentId: string; createdById: string }>) {
    this.logger.log(
      `[no-op] would create occurrence for schedule ${job.data.scheduleId} ` +
        `(payment ${job.data.paymentId}) at ${new Date().toISOString()}`,
    );
    return { acknowledged: true };
  }
}
