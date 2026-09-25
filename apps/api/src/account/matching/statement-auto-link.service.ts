// Phase 20 · Iteration 20.6 — the trigger of the transaction → line
// enrichment (design §5.5).
//
// The design asks for auto-linking "post-commit, best-effort" after a
// transaction is created with an account and after a receipt confirm
// produces or updates one. Both moments already announce themselves on the
// in-process event bus (`transaction.created` / `transaction.updated`,
// published after the write commits), so this module SUBSCRIBES instead of
// being called: the transaction and receipt modules stay unaware of
// accounts, and `AccountModule → TransactionModule` stays the one-way
// dependency it is.

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from 'rxjs';
import { EventBus } from '../../realtime/event-bus.service';
import type { RealtimeEvent } from '../../realtime/events.types';
import { MATCHABLE_STATUSES, StatementMatchingService } from './statement-matching.service';

@Injectable()
export class StatementAutoLinkService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StatementAutoLinkService.name);
  private subscription: Subscription | null = null;

  constructor(
    private readonly eventBus: EventBus,
    private readonly matching: StatementMatchingService,
  ) {}

  onModuleInit(): void {
    this.subscription = this.eventBus.subscribeAll().subscribe((event) => this.handle(event));
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  /**
   * Fire-and-forget: the HTTP response never waits on the link, and a
   * transaction that obviously cannot match one — no account, a transfer, a
   * plan parent, a cancelled row, or one a statement line already confirmed
   * — costs no query at all.
   *
   * The actor is the transaction's creator: the event carries no editor, and
   * the creator is by construction someone the row is visible to, so the
   * link is decided and audited under a real, entitled identity rather than
   * a system one.
   */
  handle(event: RealtimeEvent): void {
    if (event.type !== 'transaction.created' && event.type !== 'transaction.updated') return;

    const transaction = event.transaction;
    if (!transaction.accountId) return;
    if (transaction.transferAccountId) return;
    if (transaction.statementLineId) return;
    if (transaction.type !== 'ONE_TIME') return;
    if (!(MATCHABLE_STATUSES as readonly string[]).includes(transaction.status)) return;

    void this.matching
      .autoLink(transaction.createdById, transaction.id)
      .catch((err: Error) =>
        this.logger.warn(`Auto-link trigger failed for ${transaction.id}: ${err.message}`),
      );
  }
}
