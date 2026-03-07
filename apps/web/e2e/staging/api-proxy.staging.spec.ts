import { test, expect } from '@playwright/test';

test.describe('Staging – API proxy endpoints', () => {
  test('GET /api/v1/health should return JSON with status "ok"', async ({ request }) => {
    const response = await request.get('/api/v1/health');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('ok');
  });

  test('GET /api/v1/ should return JSON with name "MyFinPro API"', async ({ request }) => {
    const response = await request.get('/api/v1/');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.name).toBe('MyFinPro API');
  });
});
