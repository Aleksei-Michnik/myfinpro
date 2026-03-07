import { stagingFetch, stagingFetchJson } from './helpers';

describe('Staging – GET /health', () => {
  it('should return 200 status', async () => {
    const response = await stagingFetch('/health');
    expect(response.status).toBe(200);
  });

  it('should contain status "ok"', async () => {
    const { body } = await stagingFetchJson('/health');
    expect(body.status).toBe('ok');
  });

  it('should contain info object with component health indicators', async () => {
    const { body } = await stagingFetchJson('/health');
    expect(body.info).toBeDefined();
    expect(typeof body.info).toBe('object');
  });

  it('should contain details object', async () => {
    const { body } = await stagingFetchJson('/health');
    expect(body.details).toBeDefined();
    expect(typeof body.details).toBe('object');
  });

  it('should respond within 5 seconds', async () => {
    const start = Date.now();
    await stagingFetch('/health');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5_000);
  });
});
