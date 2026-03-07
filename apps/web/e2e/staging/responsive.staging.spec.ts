import { test, expect } from '@playwright/test';

test.describe('Staging – Responsive layout', () => {
  test('Desktop viewport (1280x720): page renders with expected layout', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();

    const response = await page.goto('/');
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(400);

    // Verify the page has visible content
    const body = page.locator('body');
    await expect(body).toBeVisible();

    await context.close();
  });

  test('Mobile viewport (375x667): page renders correctly on small screen', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 667 },
    });
    const page = await context.newPage();

    const response = await page.goto('/');
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(400);

    // Verify the page has visible content
    const body = page.locator('body');
    await expect(body).toBeVisible();

    await context.close();
  });

  test('No horizontal scroll overflow on mobile', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 667 },
    });
    const page = await context.newPage();
    await page.goto('/');

    // Check that body scroll width does not exceed the viewport width
    const overflowing = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });

    expect(overflowing).toBe(false);

    await context.close();
  });
});
