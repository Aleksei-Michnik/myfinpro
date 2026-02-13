import { ExecutionContext, Injectable } from '@nestjs/common';

import { CustomThrottlerGuard } from './throttler.guard';

/**
 * Throttler guard variant specifically for use behind a reverse proxy (Nginx, etc.).
 * Ensures the real client IP is extracted from X-Forwarded-For or X-Real-IP headers.
 */
@Injectable()
export class ThrottlerBehindProxyGuard extends CustomThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    // Always use IP from proxy headers when behind a proxy
    return Promise.resolve(this.extractIp(req));
  }

  protected override getRequestResponse(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    return { req, res };
  }
}
