import {
  AuthRateLimit,
  NoRateLimit,
  PublicRateLimit,
  RelaxedRateLimit,
} from './throttle.decorator';

// In @nestjs/throttler v6, metadata keys are concatenated with the throttler name
// e.g. "THROTTLER:SKIPdefault", "THROTTLER:TTLdefault", "THROTTLER:LIMITdefault"
const THROTTLER_SKIP_DEFAULT = 'THROTTLER:SKIPdefault';
const THROTTLER_TTL_DEFAULT = 'THROTTLER:TTLdefault';
const THROTTLER_LIMIT_DEFAULT = 'THROTTLER:LIMITdefault';

describe('Throttle Decorators', () => {
  describe('NoRateLimit', () => {
    it('should set THROTTLER_SKIP metadata to true for default throttler', () => {
      @NoRateLimit()
      class TestController {}

      const skipMetadata = Reflect.getMetadata(THROTTLER_SKIP_DEFAULT, TestController);
      expect(skipMetadata).toBe(true);
    });
  });

  describe('AuthRateLimit', () => {
    it('should set throttle metadata with 5 requests per 60s window', () => {
      @AuthRateLimit()
      class TestController {}

      const ttlMetadata = Reflect.getMetadata(THROTTLER_TTL_DEFAULT, TestController);
      const limitMetadata = Reflect.getMetadata(THROTTLER_LIMIT_DEFAULT, TestController);

      expect(ttlMetadata).toBe(60000);
      expect(limitMetadata).toBe(5);
    });
  });

  describe('PublicRateLimit', () => {
    it('should set throttle metadata with 5 requests per 60s window', () => {
      @PublicRateLimit()
      class TestController {}

      const ttlMetadata = Reflect.getMetadata(THROTTLER_TTL_DEFAULT, TestController);
      const limitMetadata = Reflect.getMetadata(THROTTLER_LIMIT_DEFAULT, TestController);

      expect(ttlMetadata).toBe(60000);
      expect(limitMetadata).toBe(5);
    });
  });

  describe('RelaxedRateLimit', () => {
    it('should set throttle metadata with 120 requests per 60s window', () => {
      @RelaxedRateLimit()
      class TestController {}

      const ttlMetadata = Reflect.getMetadata(THROTTLER_TTL_DEFAULT, TestController);
      const limitMetadata = Reflect.getMetadata(THROTTLER_LIMIT_DEFAULT, TestController);

      expect(ttlMetadata).toBe(60000);
      expect(limitMetadata).toBe(120);
    });
  });
});
