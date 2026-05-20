// Phase 6 · Iteration 6.18.1.4 — wire-level types for SSE events.
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

export interface PaymentSummary {
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
    icon?: string | null;
    color?: string | null;
  };
  attributions: Array<{
    scope: 'personal' | 'group';
    userId?: string | null;
    groupId?: string | null;
    groupName?: string | null;
  }>;
  note?: string | null;
  commentCount: number;
  starredByMe: boolean;
  hasDocuments: boolean;
  parentPaymentId?: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommentResponse {
  id: string;
  paymentId: string;
  author: { id: string; name: string };
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  isMine: boolean;
}

export interface ScheduleResponse {
  id: string;
  paymentId: string;
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
  | { type: 'payment.created'; payment: PaymentSummary }
  | { type: 'payment.updated'; payment: PaymentSummary }
  | { type: 'payment.deleted'; paymentId: string }
  | {
      type: 'payment_attribution.added';
      paymentId: string;
      scope: AttributionScope;
      userId?: string;
      groupId?: string;
    }
  | {
      type: 'payment_attribution.removed';
      paymentId: string;
      scope: AttributionScope;
      userId?: string;
      groupId?: string;
    }
  | { type: 'comment.created'; paymentId: string; comment: CommentResponse }
  | { type: 'comment.updated'; paymentId: string; comment: CommentResponse }
  | { type: 'comment.deleted'; paymentId: string; commentId: string }
  | { type: 'occurrence.created'; parentPaymentId: string; payment: PaymentSummary }
  | { type: 'schedule.created'; paymentId: string; schedule: ScheduleResponse }
  | { type: 'schedule.updated'; paymentId: string; schedule: ScheduleResponse }
  | { type: 'schedule.paused'; paymentId: string; schedule: ScheduleResponse }
  | { type: 'schedule.resumed'; paymentId: string; schedule: ScheduleResponse }
  | { type: 'schedule.cancelled'; paymentId: string; schedule: ScheduleResponse }
  | { type: 'schedule.deleted'; paymentId: string }
  | { type: 'ping' };

export type RealtimeEventType = RealtimeEvent['type'];

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';
