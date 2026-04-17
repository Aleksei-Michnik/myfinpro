import { test, expect } from '@playwright/test';

/**
 * Extract the staging domain from STAGING_URL for cookie setting.
 * Falls back to the default staging host.
 */
function getStagingDomain(): string {
  const url = process.env.STAGING_URL || 'https://stage-myfin.michnik.pro';
  try {
    return new URL(url).hostname;
  } catch {
    return 'stage-myfin.michnik.pro';
  }
}

test.describe('Staging – Internationalization (i18n)', () => {
  test('Default locale (English): / loads with English content', async ({ page }) => {
    const response = await page.goto('/');
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(400);

    // Verify English content — html lang should be "en"
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'en');
  });

  test('Hebrew locale via cookie: page loads with Hebrew content and RTL', async ({
    context,
    page,
  }) => {
    await context.addCookies([
      {
        name: 'NEXT_LOCALE',
        value: 'he',
        domain: getStagingDomain(),
        path: '/',
      },
    ]);

    const response = await page.goto('/');
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(400);

    // Verify Hebrew content — html lang should be "he"
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'he');
    await expect(html).toHaveAttribute('dir', 'rtl');
  });

  test('Old /en URL redirects to clean path', async ({ page }) => {
    const response = await page.goto('/en');
    expect(response).not.toBeNull();

    // After redirect, the URL should NOT contain /en prefix
    const url = page.url();
    expect(url).not.toMatch(/\/en\b/);
  });

  test('Old /he URL redirects to clean path', async ({ page }) => {
    const response = await page.goto('/he');
    expect(response).not.toBeNull();

    // After redirect, the URL should NOT contain /he prefix
    const url = page.url();
    expect(url).not.toMatch(/\/he\b/);
  });

  test('Old /en/legal/terms redirects to /legal/terms', async ({ page }) => {
    const response = await page.goto('/en/legal/terms');
    expect(response).not.toBeNull();

    await expect(page).toHaveURL(/\/legal\/terms/);
    // Should not contain locale prefix
    expect(page.url()).not.toMatch(/\/en\//);
  });

  test('Old /he/legal/terms redirects to /legal/terms', async ({ page }) => {
    const response = await page.goto('/he/legal/terms');
    expect(response).not.toBeNull();

    await expect(page).toHaveURL(/\/legal\/terms/);
    // Should not contain locale prefix
    expect(page.url()).not.toMatch(/\/he\//);
  });
});
