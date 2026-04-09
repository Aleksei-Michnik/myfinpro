import { test, expect } from '@playwright/test';

test.describe('Staging – Legal Pages', () => {
  test('Terms of Use page is accessible and renders', async ({ page }) => {
    const response = await page.goto('/en/legal/terms');
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(400);
    await expect(page.getByRole('heading', { name: 'Terms of Use' })).toBeVisible();
  });

  test('Privacy Policy page is accessible and renders', async ({ page }) => {
    const response = await page.goto('/en/legal/privacy');
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(400);
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
  });

  test('Terms page has cross-link to Privacy', async ({ page }) => {
    await page.goto('/en/legal/terms');
    const privacyLink = page.locator('a[href*="/legal/privacy"]');
    await expect(privacyLink).toBeVisible();
  });

  test('Privacy page has cross-link to Terms', async ({ page }) => {
    await page.goto('/en/legal/privacy');
    const termsLink = page.locator('a[href*="/legal/terms"]');
    await expect(termsLink).toBeVisible();
  });
});
