import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('recordRequest', () => {
    it('should record a request and increment total count', () => {
      service.recordRequest({
        method: 'GET',
        path: '/api/v1/test',
        statusCode: 200,
        duration: 50,
        timestamp: Date.now(),
      });

      const metrics = service.getMetrics();
      expect(metrics.requests.total).toBe(1);
      expect(metrics.requests.byMethod['GET']).toBe(1);
      expect(metrics.requests.byStatusCode['200']).toBe(1);
    });

    it('should track errors for 4xx and 5xx status codes', () => {
      service.recordRequest({
        method: 'GET',
        path: '/api/v1/test',
        statusCode: 404,
        duration: 10,
        timestamp: Date.now(),
      });

      service.recordRequest({
        method: 'POST',
        path: '/api/v1/test',
        statusCode: 500,
        duration: 20,
        timestamp: Date.now(),
      });

      const metrics = service.getMetrics();
      expect(metrics.errors.total).toBe(2);
      expect(metrics.errors.byStatusCode['404']).toBe(1);
      expect(metrics.errors.byStatusCode['500']).toBe(1);
    });

    it('should not track errors for 2xx and 3xx status codes', () => {
      service.recordRequest({
        method: 'GET',
        path: '/api/v1/test',
        statusCode: 200,
        duration: 10,
        timestamp: Date.now(),
      });

      service.recordRequest({
        method: 'GET',
        path: '/api/v1/test',
        statusCode: 301,
        duration: 5,
        timestamp: Date.now(),
      });

      const metrics = service.getMetrics();
      expect(metrics.errors.total).toBe(0);
    });

    it('should track multiple methods', () => {
      service.recordRequest({
        method: 'GET',
        path: '/api/v1/test',
        statusCode: 200,
        duration: 50,
        timestamp: Date.now(),
      });

      service.recordRequest({
        method: 'POST',
        path: '/api/v1/test',
        statusCode: 201,
        duration: 100,
        timestamp: Date.now(),
      });

      const metrics = service.getMetrics();
      expect(metrics.requests.byMethod['GET']).toBe(1);
      expect(metrics.requests.byMethod['POST']).toBe(1);
    });

    it('should normalize paths with UUIDs', () => {
      service.recordRequest({
        method: 'GET',
        path: '/api/v1/users/550e8400-e29b-41d4-a716-446655440000',
        statusCode: 200,
        duration: 50,
        timestamp: Date.now(),
      });

      const metrics = service.getMetrics();
      expect(metrics.requests.byPath['/api/v1/users/:id']).toBe(1);
    });

    it('should normalize paths with numeric IDs', () => {
      service.recordRequest({
        method: 'GET',
        path: '/api/v1/users/123',
        statusCode: 200,
        duration: 50,
        timestamp: Date.now(),
      });

      const metrics = service.getMetrics();
      expect(metrics.requests.byPath['/api/v1/users/:id']).toBe(1);
    });
  });

  describe('getMetrics', () => {
    it('should return uptime in seconds', () => {
      const metrics = service.getMetrics();
      expect(metrics.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should calculate latency percentiles', () => {
      // Record multiple requests with known durations
      const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      for (const duration of durations) {
        service.recordRequest({
          method: 'GET',
          path: '/test',
          statusCode: 200,
          duration,
          timestamp: Date.now(),
        });
      }

      const metrics = service.getMetrics();
      expect(metrics.latency.p50).toBe(50);
      expect(metrics.latency.p95).toBe(100);
      expect(metrics.latency.p99).toBe(100);
      expect(metrics.latency.avg).toBe(55);
    });

    it('should return zero latency when no requests', () => {
      const metrics = service.getMetrics();
      expect(metrics.latency.p50).toBe(0);
      expect(metrics.latency.p95).toBe(0);
      expect(metrics.latency.p99).toBe(0);
      expect(metrics.latency.avg).toBe(0);
    });
  });

  describe('activeConnections', () => {
    it('should track active connections', () => {
      service.incrementActiveConnections();
      service.incrementActiveConnections();

      let metrics = service.getMetrics();
      expect(metrics.activeConnections).toBe(2);

      service.decrementActiveConnections();
      metrics = service.getMetrics();
      expect(metrics.activeConnections).toBe(1);
    });

    it('should not go below zero', () => {
      service.decrementActiveConnections();
      const metrics = service.getMetrics();
      expect(metrics.activeConnections).toBe(0);
    });
  });

  describe('incrementErrors', () => {
    it('should track errors independently', () => {
      service.incrementErrors(500);
      service.incrementErrors(500);
      service.incrementErrors(503);

      const metrics = service.getMetrics();
      expect(metrics.errors.total).toBe(3);
      expect(metrics.errors.byStatusCode['500']).toBe(2);
      expect(metrics.errors.byStatusCode['503']).toBe(1);
    });
  });

  describe('reset', () => {
    it('should reset all metrics', () => {
      service.recordRequest({
        method: 'GET',
        path: '/test',
        statusCode: 200,
        duration: 50,
        timestamp: Date.now(),
      });
      service.incrementActiveConnections();
      service.incrementErrors(500);

      service.reset();

      const metrics = service.getMetrics();
      expect(metrics.requests.total).toBe(0);
      expect(metrics.errors.total).toBe(0);
      expect(metrics.activeConnections).toBe(0);
      expect(metrics.latency.avg).toBe(0);
    });
  });
});
