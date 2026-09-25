import { test, expect } from '@playwright/test';

test.describe('Help Page', () => {
  test('Help page renders guide title', async ({ page }) => {
    await page.goto('/help');
    await expect(page.getByRole('heading', { name: 'How to Use MyFinPro' })).toBeVisible();
  });

  test('Help page has section headings', async ({ page }) => {
    await page.goto('/help');
    // The help page should contain multiple section headings
    const headings = page.locator('h2, h3');
    const count = await headings.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('Help page content is non-empty', async ({ page }) => {
    await page.goto('/help');
    // The help page renders an <article>, not a <main> landmark.
    const article = page.getByRole('article');
    const text = await article.textContent();
    expect(text && text.length > 100).toBeTruthy();
  });

  test('Hebrew help page renders RTL guide title', async ({ context, page }) => {
    await context.addCookies([
      {
        name: 'NEXT_LOCALE',
        value: 'he',
        domain: 'localhost',
        path: '/',
      },
    ]);
    await page.goto('/help');
    // Today's Hebrew copy is "כיצד" (not "איך") להשתמש ב-MyFinPro.
    const heading = page.getByRole('heading', { name: 'כיצד להשתמש ב-MyFinPro' });
    await expect(heading).toBeVisible();
  });

  test('Hebrew help page has section headings', async ({ context, page }) => {
    await context.addCookies([
      {
        name: 'NEXT_LOCALE',
        value: 'he',
        domain: 'localhost',
        path: '/',
      },
    ]);
    await page.goto('/help');
    const headings = page.locator('h2, h3');
    const count = await headings.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
