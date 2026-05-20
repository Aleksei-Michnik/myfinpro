// Phase 6 · Iteration 6.18.1.4 — typed event bus.
//
// Single chokepoint for all realtime event emissions. Producers call
// `publish()`; the SSE controller (and any future consumer) calls
// `subscribeForUser()` to receive only the events targeted at one user.
//
// Implementation: pure rxjs Subject — no extra dependency. The bus is a
// hot, multicast Subject<RealtimeEvent>; per-user Observables are filtered
// views (lazy, no manual cleanup needed because rxjs handles unsubscription
// when the consumer's Observable subscription is torn down).

import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Observable, Subject, filter } from 'rxjs';
import type { RealtimeEvent } from './events.types';

@Injectable()
export class EventBus implements OnApplicationShutdown {
  private readonly logger = new Logger(EventBus.name);
  private readonly subject = new Subject<RealtimeEvent>();

  /**
   * Emit a realtime event onto the bus. The event is fanned out to every
   * subscriber whose filter matches.
   *
   * Producers MUST populate `userIds` exhaustively — the bus does not infer
   * recipients from event content.
   */
  publish(event: RealtimeEvent): void {
    if (!event.userIds || event.userIds.length === 0) {
      this.logger.warn(`Event ${event.type} published with no userIds — dropped`);
      return;
    }
    this.subject.next(event);
  }

  /**
   * Get a per-user Observable. Filters the global stream to only events
   * whose `userIds` includes the requesting user. The returned Observable
   * is cold-from-the-consumer's-POV: each subscription independently
   * filters the shared upstream Subject.
   */
  subscribeForUser(userId: string): Observable<RealtimeEvent> {
    return this.subject.asObservable().pipe(filter((e) => e.userIds.includes(userId)));
  }

  /**
   * Test/utility hook: completes the underlying Subject so any open
   * subscriber observable terminates cleanly. Safe to call multiple times.
   */
  onApplicationShutdown(): void {
    if (!this.subject.closed) {
      this.subject.complete();
    }
  }
}
