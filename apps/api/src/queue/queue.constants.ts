/**
 * Single source of truth for BullMQ queue names.
 *
 * Use these constants with `@InjectQueue(...)` and `@Processor(...)` so the
 * literal string never appears in feature code. Adding a new queue means
 * adding a new constant here _and_ registering it via
 * [`QueueModule`](apps/api/src/queue/queue.module.ts:1).
 */

/**
 * Recurring-payment occurrence queue (Phase 6.17).
 *
 * Producer: payment-schedule service (lands in 6.17.2).
 * Consumer: payment-occurrence processor (lands in 6.17.3).
 */
export const PAYMENT_OCCURRENCES_QUEUE = 'payment-occurrences';
