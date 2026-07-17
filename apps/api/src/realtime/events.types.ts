// Phase 6 · Iteration 6.18.1.4 — SSE realtime infrastructure.
//
// Discriminated union of all server-side realtime events. The union is the
// single contract between event producers (transaction / comment / schedule
// services in 6.18.1.4.1+) and the EventBus / EventsController.
//
// Every event carries `userIds` — the list of users who should receive the
// event over their personal SSE stream. The controller filters per
// authenticated user; the wire payload sent to the browser does NOT include
// `userIds` (see [`apps/web/src/lib/realtime/realtime-types.ts`](../../../web/src/lib/realtime/realtime-types.ts)).

import type { ReceiptExtractionProgress } from '@myfinpro/shared';
import type { ReceiptResponseDto } from '../receipt/dto/receipt-response.dto';
import type { CommentResponseDto } from '../transaction/dto/comment-response.dto';
import type { ScheduleResponseDto } from '../transaction/dto/schedule-response.dto';
import type { TransactionSummaryDto } from '../transaction/dto/transaction-summary.dto';

/** Re-export aliases so consumers don't have to know the DTO suffix. */
export type TransactionSummary = TransactionSummaryDto;
export type CommentResponse = CommentResponseDto;
export type ScheduleResponse = ScheduleResponseDto;
export type ReceiptResponse = ReceiptResponseDto;

export type AttributionScope = 'personal' | 'group';

export type RealtimeEvent =
  | { type: 'transaction.created'; userIds: string[]; transaction: TransactionSummary }
  | { type: 'transaction.updated'; userIds: string[]; transaction: TransactionSummary }
  | { type: 'transaction.deleted'; userIds: string[]; transactionId: string }
  | {
      type: 'transaction_attribution.added';
      userIds: string[];
      transactionId: string;
      scope: AttributionScope;
      userId?: string;
      groupId?: string;
    }
  | {
      type: 'transaction_attribution.removed';
      userIds: string[];
      transactionId: string;
      scope: AttributionScope;
      userId?: string;
      groupId?: string;
    }
  | { type: 'comment.created'; userIds: string[]; transactionId: string; comment: CommentResponse }
  | { type: 'comment.updated'; userIds: string[]; transactionId: string; comment: CommentResponse }
  | { type: 'comment.deleted'; userIds: string[]; transactionId: string; commentId: string }
  | {
      type: 'occurrence.created';
      userIds: string[];
      parentTransactionId: string;
      transaction: TransactionSummary;
    }
  | {
      type: 'schedule.created';
      userIds: string[];
      transactionId: string;
      schedule: ScheduleResponse;
    }
  | {
      type: 'schedule.updated';
      userIds: string[];
      transactionId: string;
      schedule: ScheduleResponse;
    }
  | {
      type: 'schedule.paused';
      userIds: string[];
      transactionId: string;
      schedule: ScheduleResponse;
    }
  | {
      type: 'schedule.resumed';
      userIds: string[];
      transactionId: string;
      schedule: ScheduleResponse;
    }
  | {
      type: 'schedule.cancelled';
      userIds: string[];
      transactionId: string;
      schedule: ScheduleResponse;
    }
  | { type: 'schedule.deleted'; userIds: string[]; transactionId: string }
  // Phase 7.4 — receipt lifecycle. Recipients: the uploader only (receipts
  // are private until confirmed; confirm reuses transaction.created fan-out).
  | { type: 'receipt.updated'; userIds: string[]; receipt: ReceiptResponse }
  | { type: 'receipt.deleted'; userIds: string[]; receiptId: string }
  // Phase 8.26 — transient extraction progress (uploader only). Never
  // persisted: in-memory bus, no DTO, no DB column, no audit row.
  | {
      type: 'receipt.extraction.progress';
      userIds: string[];
      receiptId: string;
      progress: ReceiptExtractionProgress;
    }
  // Phase 10.2 — budget lifecycle. Advisory (design §2.6): fired on every
  // budget mutation (create / edit / delete / archive / unarchive); clients
  // refetch budget lists on receipt. Recipients: the owner (personal) or
  // all group members (group).
  | { type: 'budget.updated'; userIds: string[]; budgetId: string };

export type RealtimeEventType = RealtimeEvent['type'];
