import { stagingFetchWithRetry, stagingFetchJsonWithRetry } from './helpers';

describe('Staging – GET /health', () => {
  it('should return 200 status', async () => {
    const response = await stagingFetchWithRetry('/health', {
      retries: 5,
      delayMs: 3000,
    });
    expect(response.status).toBe(200);
  });

  it('should contain status "ok"', async () => {
    const { body } = await stagingFetchJsonWithRetry('/health', {
      retries: 5,
      delayMs: 3000,
    });
    expect(body.status).toBe('ok');
  });

  it('should contain info object with component health indicators', async () => {
    const { body } = await stagingFetchJsonWithRetry('/health', {
      retries: 5,
      delayMs: 3000,
    });
    expect(body.info).toBeDefined();
    expect(typeof body.info).toBe('object');
  });

  it('should contain details object', async () => {
    const { body } = await stagingFetchJsonWithRetry('/health', {
      retries: 5,
      delayMs: 3000,
    });
    expect(body.details).toBeDefined();
    expect(typeof body.details).toBe('object');
  });

  it('should respond within 5 seconds', async () => {
    const start = Date.now();
    await stagingFetchWithRetry('/health', { retries: 1 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5_000);
  });
});
