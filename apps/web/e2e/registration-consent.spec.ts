import { test, expect } from '@playwright/test';

test.describe('Registration Consent', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/register');
    // Wait for the form to be fully rendered
    await expect(page.locator('form')).toBeVisible();
  });

  test('registration page has consent checkbox', async ({ page }) => {
    const checkbox = page.getByTestId('consent-checkbox');
    await expect(checkbox).toBeVisible();
    // Should be unchecked by default
    await expect(checkbox).not.toBeChecked();
  });

  test('submit button is disabled when consent is not checked', async ({ page }) => {
    // The submit button should be disabled initially (empty form + no consent)
    const submitButton = page.getByRole('button', { name: /sign up/i });
    await expect(submitButton).toBeDisabled();

    // Fill all fields but do NOT check consent
    await page.getByLabel(/full name/i).click();
    await page.getByLabel(/full name/i).pressSequentially('Test User');
    await page.getByLabel(/email/i).click();
    await page.getByLabel(/email/i).pressSequentially('test@example.com');

    // Find password fields - get the first one (password) and second one (confirm)
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.nth(0).click();
    await passwordInputs.nth(0).pressSequentially('SecurePass123');
    await passwordInputs.nth(1).click();
    await passwordInputs.nth(1).pressSequentially('SecurePass123');

    // Button should still be disabled without consent
    await expect(submitButton).toBeDisabled();
  });

  test('consent checkbox has links to terms and privacy pages', async ({ page }) => {
    // The consent label should contain links to legal pages
    const consentArea = page.locator('label:has([data-testid="consent-checkbox"])');
    const termsLink = consentArea.locator('a[href*="/legal/terms"]');
    const privacyLink = consentArea.locator('a[href*="/legal/privacy"]');

    await expect(termsLink).toBeVisible();
    await expect(privacyLink).toBeVisible();
  });

  test('consent terms link navigates to terms page', async ({ page }) => {
    const consentArea = page.locator('label:has([data-testid="consent-checkbox"])');
    const termsLink = consentArea.locator('a[href*="/legal/terms"]');
    await termsLink.click();
    await expect(page).toHaveURL(/\/legal\/terms/);
  });

  test('consent privacy link navigates to privacy page', async ({ page }) => {
    const consentArea = page.locator('label:has([data-testid="consent-checkbox"])');
    const privacyLink = consentArea.locator('a[href*="/legal/privacy"]');
    await privacyLink.click();
    await expect(page).toHaveURL(/\/legal\/privacy/);
  });
});
