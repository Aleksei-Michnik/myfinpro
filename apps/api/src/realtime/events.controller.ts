// Phase 6 · Iteration 6.18.1.4 — SSE endpoint.
//
// Browsers receive realtime updates via `EventSource` from
// `GET /api/v1/events/stream`. Each connection is filtered server-side
// to events targeted at the authenticated user (see [`EventBus.subscribeForUser()`](event-bus.service.ts:43)).
//
// Wire format: standard `text/event-stream` with an incrementing `id:`
// for `Last-Event-ID` resumption (the field is sent; consumers in
// 6.18.1.4.1+ may use it for replay if they choose). A `ping` heartbeat
// every 30s keeps idle proxies from closing the connection.

import { Controller, Logger, OnApplicationShutdown, Req, Sse, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Observable, Subject, finalize, interval, map, merge, takeUntil } from 'rxjs';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { EventBus } from './event-bus.service';
import { RealtimeAuthGuard } from './realtime-auth.guard';

/** Mirror of NestJS's MessageEvent — declared to keep the type local. */
interface SseMessage {
  data: unknown;
  id?: string;
  type?: string;
  retry?: number;
}

const HEARTBEAT_MS = 30_000;

@ApiTags('Realtime')
@Controller('events')
export class EventsController implements OnApplicationShutdown {
  private readonly logger = new Logger(EventsController.name);
  /** Emits when the application shuts down so all SSE streams complete. */
  private readonly shutdown$ = new Subject<void>();
  private nextEventId = 0;
  private activeStreams = 0;

  constructor(private readonly eventBus: EventBus) {}

  @UseGuards(RealtimeAuthGuard)
  @Sse('stream')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Server-Sent Events stream for realtime updates (cookie or Bearer auth)',
  })
  stream(@CurrentUser() user: JwtPayload, @Req() request: Request): Observable<SseMessage> {
    const userId = user.sub;
    this.activeStreams += 1;
    this.logger.debug(`SSE stream opened for user ${userId} (active=${this.activeStreams})`);

    // Close cleanly when the client disconnects.
    const clientClose$ = new Subject<void>();
    request.on('close', () => clientClose$.next());

    const events$ = this.eventBus.subscribeForUser(userId).pipe(
      map((event): SseMessage => {
        this.nextEventId += 1;
        return { id: String(this.nextEventId), data: event };
      }),
    );

    const heartbeat$ = interval(HEARTBEAT_MS).pipe(
      map(
        (): SseMessage => ({
          id: String(++this.nextEventId),
          data: { type: 'ping' },
        }),
      ),
    );

    return merge(events$, heartbeat$).pipe(
      takeUntil(this.shutdown$),
      takeUntil(clientClose$),
      finalize(() => {
        this.activeStreams = Math.max(0, this.activeStreams - 1);
        this.logger.debug(`SSE stream closed for user ${userId} (active=${this.activeStreams})`);
      }),
    );
  }

  /** Close every open stream cleanly on app shutdown. */
  onApplicationShutdown(): void {
    if (!this.shutdown$.closed) {
      this.shutdown$.next();
      this.shutdown$.complete();
    }
  }
}
