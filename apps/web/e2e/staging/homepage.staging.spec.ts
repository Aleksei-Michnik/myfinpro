import { test, expect } from '@playwright/test';

test.describe('Staging – Homepage', () => {
  test('should load successfully', async ({ page }) => {
    const response = await page.goto('/');
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(400);
  });

  test('should have page title containing "MyFinPro"', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/MyFinPro/i);
  });

  test('should have main heading "MyFinPro" visible', async ({ page }) => {
    await page.goto('/');
    const heading = page.getByRole('heading', { name: /MyFinPro/i });
    await expect(heading).toBeVisible();
  });

  test('should load within 10 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(10_000);
  });
});
