import { test, expect } from '@playwright/test';

test.describe('Staging – Help Page', () => {
  test('Help page is accessible and renders', async ({ page }) => {
    const response = await page.goto('/help');
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(400);
    await expect(page.getByRole('heading', { name: 'How to Use MyFinPro' })).toBeVisible();
  });

  test('Help page has section headings', async ({ page }) => {
    await page.goto('/help');
    const headings = page.locator('h2, h3');
    const count = await headings.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
