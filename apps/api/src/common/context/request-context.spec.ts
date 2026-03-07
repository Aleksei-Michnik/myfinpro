import {
  requestContextStorage,
  createRequestContext,
  getRequestContext,
  getRequestId,
} from './request-context';

describe('RequestContext', () => {
  describe('createRequestContext', () => {
    it('should create a context with the provided requestId', () => {
      const context = createRequestContext('test-id-123');

      expect(context.requestId).toBe('test-id-123');
    });

    it('should include a startTime', () => {
      const before = Date.now();
      const context = createRequestContext('id');
      const after = Date.now();

      expect(context.startTime).toBeGreaterThanOrEqual(before);
      expect(context.startTime).toBeLessThanOrEqual(after);
    });

    it('should generate a UUID if no requestId is provided', () => {
      const context = createRequestContext();

      expect(context.requestId).toBeDefined();
      expect(typeof context.requestId).toBe('string');
      expect(context.requestId.length).toBeGreaterThan(0);
    });
  });

  describe('getRequestContext', () => {
    it('should return undefined outside of run() context', () => {
      const context = getRequestContext();

      expect(context).toBeUndefined();
    });

    it('should return the context within run() callback', (done) => {
      const data = createRequestContext('inside-context');

      requestContextStorage.run(data, () => {
        const current = getRequestContext();
        expect(current).toBeDefined();
        expect(current?.requestId).toBe('inside-context');
        done();
      });
    });
  });

  describe('getRequestId', () => {
    it('should return undefined outside of run() context', () => {
      const id = getRequestId();

      expect(id).toBeUndefined();
    });

    it('should return the correct requestId within context', (done) => {
      const data = createRequestContext('req-id-456');

      requestContextStorage.run(data, () => {
        const id = getRequestId();
        expect(id).toBe('req-id-456');
        done();
      });
    });
  });

  describe('nested contexts', () => {
    it('should create separate contexts for nested run() calls', (done) => {
      const outerData = createRequestContext('outer-id');
      const innerData = createRequestContext('inner-id');

      requestContextStorage.run(outerData, () => {
        expect(getRequestId()).toBe('outer-id');

        requestContextStorage.run(innerData, () => {
          expect(getRequestId()).toBe('inner-id');
          done();
        });
      });
    });

    it('should restore outer context after inner run() completes', (done) => {
      const outerData = createRequestContext('outer-id');
      const innerData = createRequestContext('inner-id');

      requestContextStorage.run(outerData, () => {
        expect(getRequestId()).toBe('outer-id');

        requestContextStorage.run(innerData, () => {
          expect(getRequestId()).toBe('inner-id');
        });

        // After inner run completes synchronously, outer context is restored
        expect(getRequestId()).toBe('outer-id');
        done();
      });
    });
  });
});
