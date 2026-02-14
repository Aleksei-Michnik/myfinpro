import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';

import { MetricsService } from '../metrics/metrics.service';

import { CustomThrottlerGuard } from './throttler.guard';

/** Helper type to access protected methods in tests */
type TestableThrottlerGuard = {
  getTracker: (req: Record<string, unknown>) => Promise<string>;
  throwThrottlingException: (
    context: ExecutionContext,
    detail: Record<string, unknown>,
  ) => Promise<void>;
};

describe('CustomThrottlerGuard', () => {
  let guard: CustomThrottlerGuard;
  let metricsService: MetricsService;

  const mockOptions: ThrottlerModuleOptions = {
    throttlers: [{ name: 'default', ttl: 60000, limit: 60 }],
  };

  const mockStorageService = {
    increment: jest.fn(),
    get: jest.fn(),
  } as unknown as ThrottlerStorage;

  const mockReflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;

  beforeEach(() => {
    metricsService = new MetricsService();
    guard = new CustomThrottlerGuard(
      mockOptions,
      mockStorageService,
      mockReflector,
      metricsService,
    );
  });

  describe('extractIp', () => {
    it('should extract IP from X-Forwarded-For header', () => {
      const req = {
        headers: {
          'x-forwarded-for': '203.0.113.50, 70.41.3.18, 150.172.238.178',
        },
        ip: '127.0.0.1',
      };

      const ip = guard.extractIp(req);
      expect(ip).toBe('203.0.113.50');
    });

    it('should extract IP from single X-Forwarded-For value', () => {
      const req = {
        headers: {
          'x-forwarded-for': '192.168.1.100',
        },
        ip: '127.0.0.1',
      };

      const ip = guard.extractIp(req);
      expect(ip).toBe('192.168.1.100');
    });

    it('should extract IP from X-Real-IP header', () => {
      const req = {
        headers: {
          'x-real-ip': '10.0.0.1',
        },
        ip: '127.0.0.1',
      };

      const ip = guard.extractIp(req);
      expect(ip).toBe('10.0.0.1');
    });

    it('should prefer X-Forwarded-For over X-Real-IP', () => {
      const req = {
        headers: {
          'x-forwarded-for': '203.0.113.50',
          'x-real-ip': '10.0.0.1',
        },
        ip: '127.0.0.1',
      };

      const ip = guard.extractIp(req);
      expect(ip).toBe('203.0.113.50');
    });

    it('should fall back to direct IP when no proxy headers', () => {
      const req = {
        headers: {},
        ip: '192.168.0.1',
      };

      const ip = guard.extractIp(req);
      expect(ip).toBe('192.168.0.1');
    });

    it('should return 127.0.0.1 when no IP available', () => {
      const req = {
        headers: {},
      };

      const ip = guard.extractIp(req);
      expect(ip).toBe('127.0.0.1');
    });

    it('should handle array X-Forwarded-For header', () => {
      const req = {
        headers: {
          'x-forwarded-for': ['203.0.113.50, 70.41.3.18'],
        },
        ip: '127.0.0.1',
      };

      const ip = guard.extractIp(req);
      expect(ip).toBe('203.0.113.50');
    });
  });

  describe('getTracker', () => {
    it('should return user-based tracker when user is authenticated', async () => {
      const req = {
        user: { id: 'user-123' },
        headers: {},
        ip: '192.168.0.1',
      };

      const tracker = await (guard as unknown as TestableThrottlerGuard).getTracker(req);
      expect(tracker).toBe('user-user-123');
    });

    it('should return IP-based tracker when user is not authenticated', async () => {
      const req = {
        headers: { 'x-forwarded-for': '10.0.0.5' },
        ip: '192.168.0.1',
      };

      const tracker = await (guard as unknown as TestableThrottlerGuard).getTracker(req);
      expect(tracker).toBe('10.0.0.5');
    });

    it('should return IP-based tracker when user has no id', async () => {
      const req = {
        user: {},
        headers: {},
        ip: '192.168.0.1',
      };

      const tracker = await (guard as unknown as TestableThrottlerGuard).getTracker(req);
      expect(tracker).toBe('192.168.0.1');
    });
  });

  describe('throwThrottlingException', () => {
    it('should log rate limit violation and increment error metrics', async () => {
      const incrementErrorsSpy = jest.spyOn(metricsService, 'incrementErrors');

      const mockRequest = {
        method: 'GET',
        url: '/api/v1/test',
        headers: {},
        ip: '192.168.0.1',
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
          getResponse: () => ({}),
        }),
        getType: () => 'http',
        getClass: () => ({}),
        getHandler: () => ({}),
      } as unknown as ExecutionContext;

      const throttlerLimitDetail = {
        ttl: 60000,
        limit: 60,
        key: 'test-key',
        tracker: '192.168.0.1',
        totalHits: 61,
        timeToExpire: 30000,
        isBlocked: true,
        timeToBlockExpire: 30000,
      };

      await expect(
        (guard as unknown as TestableThrottlerGuard).throwThrottlingException(
          mockContext,
          throttlerLimitDetail,
        ),
      ).rejects.toThrow();

      expect(incrementErrorsSpy).toHaveBeenCalledWith(429);
    });
  });
});
