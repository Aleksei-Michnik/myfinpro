import { test, expect } from '@playwright/test';

test.describe('Footer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('footer is visible on homepage', async ({ page }) => {
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
  });

  test('footer contains Terms of Use link with correct text and href', async ({ page }) => {
    const termsLink = page.locator('footer a[href="/legal/terms"]');
    await expect(termsLink).toBeVisible();
    await expect(termsLink).toHaveText('Terms of Use');
  });

  test('footer contains Privacy Policy link with correct text and href', async ({ page }) => {
    const privacyLink = page.locator('footer a[href="/legal/privacy"]');
    await expect(privacyLink).toBeVisible();
    await expect(privacyLink).toHaveText('Privacy Policy');
  });

  test('footer contains Help link with correct text and href', async ({ page }) => {
    const helpLink = page.locator('footer a[href="/help"]');
    await expect(helpLink).toBeVisible();
    await expect(helpLink).toHaveText('Help');
  });

  test('footer contains copyright text with current year', async ({ page }) => {
    const year = new Date().getFullYear().toString();
    const footer = page.locator('footer');
    await expect(footer).toContainText(`© ${year} MyFinPro`);
  });

  test('Terms of Use link navigates to terms page', async ({ page }) => {
    const termsLink = page.locator('footer a[href="/legal/terms"]');
    await termsLink.click();
    await expect(page).toHaveURL(/\/legal\/terms/);
    await expect(page.getByRole('heading', { name: 'Terms of Use' })).toBeVisible();
  });

  test('Privacy Policy link navigates to privacy page', async ({ page }) => {
    const privacyLink = page.locator('footer a[href="/legal/privacy"]');
    await privacyLink.click();
    await expect(page).toHaveURL(/\/legal\/privacy/);
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
  });

  test('Help link navigates to help page', async ({ page }) => {
    const helpLink = page.locator('footer a[href="/help"]');
    await helpLink.click();
    await expect(page).toHaveURL(/\/help/);
    await expect(page.getByRole('heading', { name: 'How to Use MyFinPro' })).toBeVisible();
  });

  test('footer is visible on Hebrew locale', async ({ context, page }) => {
    await context.addCookies([
      {
        name: 'NEXT_LOCALE',
        value: 'he',
        domain: 'localhost',
        path: '/',
      },
    ]);
    await page.goto('/');
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    await expect(footer).toContainText('תנאי שימוש');
    await expect(footer).toContainText('מדיניות פרטיות');
    await expect(footer).toContainText('עזרה');
  });
});
