// Phase 6 · Iteration 6.18.1.4 — RealtimeModule wiring.

import { Module } from '@nestjs/common';
import { JwtConfigModule } from '../auth/jwt-config.module';
import { EventBus } from './event-bus.service';
import { EventsController } from './events.controller';

@Module({
  // JwtConfigModule lets CookieOrBearerAuthGuard (used on the SSE stream —
  // the cookie path EventSource needs doesn't go through Passport's
  // JwtStrategy) resolve JwtService in this module's context.
  imports: [JwtConfigModule],
  controllers: [EventsController],
  providers: [EventBus],
  exports: [EventBus],
})
export class RealtimeModule {}
