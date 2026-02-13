import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';

import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(CustomThrottlerGuard.name);

  constructor(
    options: ThrottlerModuleOptions,
    storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly metricsService: MetricsService,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    // Try to get authenticated user ID first for user-based rate limiting
    const user = req['user'] as { id?: string } | undefined;
    if (user?.id) {
      return `user-${user.id}`;
    }

    // Fall back to IP-based rate limiting
    return this.extractIp(req);
  }

  /**
   * Extract client IP, handling proxy headers (X-Forwarded-For, X-Real-IP)
   */
  extractIp(req: Record<string, unknown>): string {
    const headers = req['headers'] as Record<string, string | string[] | undefined> | undefined;

    if (headers) {
      // X-Forwarded-For can contain multiple IPs: client, proxy1, proxy2
      const forwardedFor = headers['x-forwarded-for'];
      if (forwardedFor) {
        const ips = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor).split(',');
        const clientIp = ips[0]?.trim();
        if (clientIp) return clientIp;
      }

      // X-Real-IP is set by Nginx
      const realIp = headers['x-real-ip'];
      if (realIp) {
        return Array.isArray(realIp) ? realIp[0] : realIp;
      }
    }

    // Direct connection IP
    const ip = req['ip'] as string | undefined;
    return ip || '127.0.0.1';
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const request = context.switchToHttp().getRequest();
    const ip = this.extractIp(request);
    const method = request['method'] as string;
    const url = request['url'] as string;

    this.logger.warn(
      `Rate limit exceeded for IP ${ip} on ${method} ${url} ` +
        `(limit: ${throttlerLimitDetail.limit}, ttl: ${throttlerLimitDetail.ttl}ms)`,
    );

    // Track rate limit violations in metrics
    this.metricsService.incrementErrors(429);

    return super.throwThrottlingException(context, throttlerLimitDetail);
  }
}
