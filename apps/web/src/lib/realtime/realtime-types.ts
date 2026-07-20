// Phase 6 · Iteration 6.18.1.4 — wire-level types for SSE events.
import type { ReceiptExtractionProgress } from '@myfinpro/shared';
import type { ReceiptSummary } from '@/lib/receipt/types';
//
// Mirror of the backend discriminated union (see
// [`apps/api/src/realtime/events.types.ts`](../../../../api/src/realtime/events.types.ts))
// with `userIds` stripped — the server already filtered the stream to
// the authenticated user's events, so the client never sees recipient
// metadata.
//
// Future event-type additions MUST be made in both files in the same
// iteration. The `'ping'` heartbeat is client-only (the server emits it
// but it never originates from a producer service).

export interface TransactionSummary {
  id: string;
  direction: 'IN' | 'OUT';
  type: string;
  amountCents: number;
  currency: string;
  occurredAt: string;
  status: string;
  category: {
    id: string;
    slug: string;
    name: string;
    icon: string | null;
    color: string | null;
  };
  attributions: Array<{
    scope: 'personal' | 'group';
    userId: string | null;
    groupId: string | null;
    groupName: string | null;
  }>;
  note: string | null;
  commentCount: number;
  starredByMe: boolean;
  hasDocuments: boolean;
  parentTransactionId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommentResponse {
  id: string;
  transactionId: string;
  author: { id: string; name: string };
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  isMine: boolean;
}

export interface ScheduleResponse {
  id: string;
  transactionId: string;
  cron: string | null;
  everyMs: number | null;
  startsAt: string;
  endsAt: string | null;
  limit: number | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  pausedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AttributionScope = 'personal' | 'group';

export type RealtimeEvent =
  | { type: 'transaction.created'; transaction: TransactionSummary }
  | { type: 'transaction.updated'; transaction: TransactionSummary }
  | { type: 'transaction.deleted'; transactionId: string }
  | {
      type: 'transaction_attribution.added';
      transactionId: string;
      scope: AttributionScope;
      userId?: string;
      groupId?: string;
    }
  | {
      type: 'transaction_attribution.removed';
      transactionId: string;
      scope: AttributionScope;
      userId?: string;
      groupId?: string;
    }
  | { type: 'comment.created'; transactionId: string; comment: CommentResponse }
  | { type: 'comment.updated'; transactionId: string; comment: CommentResponse }
  | { type: 'comment.deleted'; transactionId: string; commentId: string }
  | { type: 'occurrence.created'; parentTransactionId: string; transaction: TransactionSummary }
  | { type: 'schedule.created'; transactionId: string; schedule: ScheduleResponse }
  | { type: 'schedule.updated'; transactionId: string; schedule: ScheduleResponse }
  | { type: 'schedule.paused'; transactionId: string; schedule: ScheduleResponse }
  | { type: 'schedule.resumed'; transactionId: string; schedule: ScheduleResponse }
  | { type: 'schedule.cancelled'; transactionId: string; schedule: ScheduleResponse }
  | { type: 'schedule.deleted'; transactionId: string }
  // Phase 7.7 — receipt lifecycle (uploader-only fan-out on the server).
  | { type: 'receipt.updated'; receipt: ReceiptSummary }
  | { type: 'receipt.deleted'; receiptId: string }
  // Phase 8.26 — transient extraction progress (never persisted server-side).
  | { type: 'receipt.extraction.progress'; receiptId: string; progress: ReceiptExtractionProgress }
  // Phase 10.2 — budget lifecycle. Advisory (design §2.6): fired on every
  // budget mutation (create / edit / delete / archive / unarchive); clients
  // refetch budget lists on receipt.
  | { type: 'budget.updated'; budgetId: string }
  | { type: 'ping' };

export type RealtimeEventType = RealtimeEvent['type'];

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';
