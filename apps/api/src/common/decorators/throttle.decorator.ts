import { SkipThrottle, Throttle } from '@nestjs/throttler';

/**
 * Skip rate limiting entirely (for health checks, metrics, etc.)
 */
export const NoRateLimit = () => SkipThrottle();

/**
 * Custom per-endpoint rate limit.
 * @param options - { limit: max requests, ttl: time window in ms }
 */
export const CustomThrottle = (options: { limit: number; ttl: number }) =>
  Throttle({ default: { ttl: options.ttl, limit: options.limit } });

/**
 * Strict rate limit for auth endpoints: 5 requests per minute
 */
export const AuthRateLimit = () => Throttle({ default: { ttl: 60000, limit: 5 } });

/**
 * Strict rate limit for public endpoints: 5 requests per minute
 */
export const PublicRateLimit = () => Throttle({ default: { ttl: 60000, limit: 5 } });

/**
 * Relaxed rate limit for read-heavy endpoints: 120 requests per minute
 */
export const RelaxedRateLimit = () => Throttle({ default: { ttl: 60000, limit: 120 } });
