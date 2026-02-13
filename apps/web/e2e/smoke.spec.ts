import { test, expect } from '@playwright/test';

test.describe('Smoke Tests', () => {
  test('homepage loads successfully', async ({ page }) => {
    await page.goto('/');

    // Verify the page title
    await expect(page).toHaveTitle(/MyFinPro/);

    // Verify main heading is visible
    await expect(page.getByRole('heading', { name: 'MyFinPro' })).toBeVisible();
  });

  test('health endpoint returns ok', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.status).toBe('ok');
  });
});
