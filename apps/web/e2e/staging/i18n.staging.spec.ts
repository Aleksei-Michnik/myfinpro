import { test, expect } from '@playwright/test';

test.describe('Staging – Internationalization (i18n)', () => {
  test('English locale: /en loads successfully with English content', async ({ page }) => {
    const response = await page.goto('/en');
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(400);

    // Verify English content is present
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'en');
  });

  test('Hebrew locale: /he loads successfully with Hebrew content', async ({ page }) => {
    const response = await page.goto('/he');
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(400);

    // Verify Hebrew content is present
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'he');
  });

  test('Hebrew layout has dir="rtl" attribute on html element', async ({ page }) => {
    await page.goto('/he');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('dir', 'rtl');
  });

  test('Default locale redirect: / redirects to /en', async ({ page }) => {
    const response = await page.goto('/');
    expect(response).not.toBeNull();

    // After redirect, the URL should contain /en
    const url = page.url();
    expect(url).toMatch(/\/en\b/);
  });
});
