import { test, expect } from '@playwright/test';

test.describe('Staging – Registration Consent', () => {
  test('registration page has consent checkbox', async ({ page }) => {
    await page.goto('/en/auth/register');
    await expect(page.locator('form')).toBeVisible();

    const checkbox = page.getByTestId('consent-checkbox');
    await expect(checkbox).toBeVisible();
    await expect(checkbox).not.toBeChecked();
  });

  test('consent label links to terms and privacy', async ({ page }) => {
    await page.goto('/en/auth/register');
    await expect(page.locator('form')).toBeVisible();

    const consentArea = page.locator('label:has([data-testid="consent-checkbox"])');
    await expect(consentArea.locator('a[href*="/legal/terms"]')).toBeVisible();
    await expect(consentArea.locator('a[href*="/legal/privacy"]')).toBeVisible();
  });
});
