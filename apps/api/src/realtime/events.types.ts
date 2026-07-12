// Phase 6 · Iteration 6.18.1.4 — SSE realtime infrastructure.
//
// Discriminated union of all server-side realtime events. The union is the
// single contract between event producers (payment / comment / schedule
// services in 6.18.1.4.1+) and the EventBus / EventsController.
//
// Every event carries `userIds` — the list of users who should receive the
// event over their personal SSE stream. The controller filters per
// authenticated user; the wire payload sent to the browser does NOT include
// `userIds` (see [`apps/web/src/lib/realtime/realtime-types.ts`](../../../web/src/lib/realtime/realtime-types.ts)).

import type { CommentResponseDto } from '../payment/dto/comment-response.dto';
import type { PaymentSummaryDto } from '../payment/dto/payment-summary.dto';
import type { ScheduleResponseDto } from '../payment/dto/schedule-response.dto';
import type { ReceiptResponseDto } from '../receipt/dto/receipt-response.dto';

/** Re-export aliases so consumers don't have to know the DTO suffix. */
export type PaymentSummary = PaymentSummaryDto;
export type CommentResponse = CommentResponseDto;
export type ScheduleResponse = ScheduleResponseDto;
export type ReceiptResponse = ReceiptResponseDto;

export type AttributionScope = 'personal' | 'group';

export type RealtimeEvent =
  | { type: 'payment.created'; userIds: string[]; payment: PaymentSummary }
  | { type: 'payment.updated'; userIds: string[]; payment: PaymentSummary }
  | { type: 'payment.deleted'; userIds: string[]; paymentId: string }
  | {
      type: 'payment_attribution.added';
      userIds: string[];
      paymentId: string;
      scope: AttributionScope;
      userId?: string;
      groupId?: string;
    }
  | {
      type: 'payment_attribution.removed';
      userIds: string[];
      paymentId: string;
      scope: AttributionScope;
      userId?: string;
      groupId?: string;
    }
  | { type: 'comment.created'; userIds: string[]; paymentId: string; comment: CommentResponse }
  | { type: 'comment.updated'; userIds: string[]; paymentId: string; comment: CommentResponse }
  | { type: 'comment.deleted'; userIds: string[]; paymentId: string; commentId: string }
  | {
      type: 'occurrence.created';
      userIds: string[];
      parentPaymentId: string;
      payment: PaymentSummary;
    }
  | { type: 'schedule.created'; userIds: string[]; paymentId: string; schedule: ScheduleResponse }
  | { type: 'schedule.updated'; userIds: string[]; paymentId: string; schedule: ScheduleResponse }
  | { type: 'schedule.paused'; userIds: string[]; paymentId: string; schedule: ScheduleResponse }
  | { type: 'schedule.resumed'; userIds: string[]; paymentId: string; schedule: ScheduleResponse }
  | { type: 'schedule.cancelled'; userIds: string[]; paymentId: string; schedule: ScheduleResponse }
  | { type: 'schedule.deleted'; userIds: string[]; paymentId: string }
  // Phase 7.4 — receipt lifecycle. Recipients: the uploader only (receipts
  // are private until confirmed; confirm reuses payment.created fan-out).
  | { type: 'receipt.updated'; userIds: string[]; receipt: ReceiptResponse }
  | { type: 'receipt.deleted'; userIds: string[]; receiptId: string }
  // Phase 10.2 — budget lifecycle. Advisory (design §2.6): fired on every
  // budget mutation (create / edit / delete / archive / unarchive); clients
  // refetch budget lists on receipt. Recipients: the owner (personal) or
  // all group members (group).
  | { type: 'budget.updated'; userIds: string[]; budgetId: string };

export type RealtimeEventType = RealtimeEvent['type'];
