import { test, expect } from '@playwright/test';

test.describe('Staging – Footer', () => {
  test('footer is present on homepage', async ({ page }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
  });

  test('footer has Terms, Privacy, and Help links', async ({ page }) => {
    await page.goto('/en');
    const footer = page.locator('footer');
    await expect(footer.locator('a[href*="/legal/terms"]')).toBeVisible();
    await expect(footer.locator('a[href*="/legal/privacy"]')).toBeVisible();
    await expect(footer.locator('a[href*="/help"]')).toBeVisible();
  });

  test('footer contains copyright text', async ({ page }) => {
    await page.goto('/en');
    const footer = page.locator('footer');
    const year = new Date().getFullYear().toString();
    await expect(footer).toContainText(`© ${year} MyFinPro`);
  });
});
