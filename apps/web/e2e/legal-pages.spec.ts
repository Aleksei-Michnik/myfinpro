import { test, expect } from '@playwright/test';

test.describe('Legal Pages', () => {
  test('Terms of Use page renders heading', async ({ page }) => {
    await page.goto('/legal/terms');
    await expect(page.getByRole('heading', { name: 'Terms of Use' })).toBeVisible();
  });

  test('Privacy Policy page renders heading', async ({ page }) => {
    await page.goto('/legal/privacy');
    await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible();
  });

  test('Terms page has link to Privacy Policy', async ({ page }) => {
    await page.goto('/legal/terms');
    const privacyLink = page.getByRole('article').locator('a[href*="/legal/privacy"]');
    await expect(privacyLink).toBeVisible();
  });

  test('Privacy page has link to Terms of Use', async ({ page }) => {
    await page.goto('/legal/privacy');
    const termsLink = page.getByRole('article').locator('a[href*="/legal/terms"]');
    await expect(termsLink).toBeVisible();
  });

  test('Hebrew Terms page renders RTL heading', async ({ context, page }) => {
    await context.addCookies([
      {
        name: 'NEXT_LOCALE',
        value: 'he',
        domain: 'localhost',
        path: '/',
      },
    ]);
    await page.goto('/legal/terms');
    const heading = page.getByRole('heading', { name: 'תנאי שימוש' });
    await expect(heading).toBeVisible();
  });

  test('Hebrew Privacy page renders RTL heading', async ({ context, page }) => {
    await context.addCookies([
      {
        name: 'NEXT_LOCALE',
        value: 'he',
        domain: 'localhost',
        path: '/',
      },
    ]);
    await page.goto('/legal/privacy');
    const heading = page.getByRole('heading', { name: 'מדיניות פרטיות' });
    await expect(heading).toBeVisible();
  });

  test('Terms page content is non-empty', async ({ page }) => {
    await page.goto('/legal/terms');
    const main = page.locator('main');
    const text = await main.textContent();
    expect(text && text.length > 100).toBeTruthy();
  });

  test('Privacy page content is non-empty', async ({ page }) => {
    await page.goto('/legal/privacy');
    const main = page.locator('main');
    const text = await main.textContent();
    expect(text && text.length > 100).toBeTruthy();
  });
});
