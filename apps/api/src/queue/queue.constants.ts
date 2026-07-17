/**
 * Single source of truth for BullMQ queue names.
 *
 * Use these constants with `@InjectQueue(...)` and `@Processor(...)` so the
 * literal string never appears in feature code. Adding a new queue means
 * adding a new constant here _and_ registering it via
 * [`QueueModule`](apps/api/src/queue/queue.module.ts:1).
 */

/**
 * Recurring-transaction occurrence queue (Phase 6.17).
 *
 * Producer: transaction-schedule service (lands in 6.17.2).
 * Consumer: transaction-occurrence processor (lands in 6.17.3).
 */
export const TRANSACTION_OCCURRENCES_QUEUE = 'transaction-occurrences';

/**
 * Receipt extraction queue (Phase 7.4).
 *
 * Producer: receipt service (upload / url / retry).
 * Consumer: receipt-extraction processor (lands in 7.6).
 */
export const RECEIPT_EXTRACTIONS_QUEUE = 'receipt-extractions';

/**
 * Product image processing queue (Phase 8.8).
 *
 * Producer: product image service (manual upload / OFF prefill URL).
 * Consumer: product-image processor (sharp resize + metadata strip).
 */
export const PRODUCT_IMAGES_QUEUE = 'product-images';

/**
 * Receipt storage compaction queue (Phase 8.25).
 *
 * Producer: receipt service (confirm / reconcile) + bootstrap backfill sweep.
 * Consumer: receipt-optimization processor (re-encode CONFIRMED pages to WebP).
 */
export const RECEIPT_OPTIMIZATIONS_QUEUE = 'receipt-optimizations';
