import { test, expect } from '@playwright/test';

test.describe('Authentication Flows', () => {
  test('should show login page with all form fields', async ({ page }) => {
    await page.goto('/en/auth/login');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    // Button is disabled when fields are empty (by design)
    await expect(page.getByRole('button', { name: /sign in/i })).toBeDisabled();
  });

  test('should show register page with all form fields', async ({ page }) => {
    await page.goto('/en/auth/register');
    await expect(page.getByRole('heading', { name: /create/i })).toBeVisible();
    await expect(page.getByLabel(/full name/i)).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign up/i })).toBeVisible();
  });

  test('should navigate between login and register', async ({ page }) => {
    await page.goto('/en/auth/login');
    // Click the "Sign Up" link from the login form (not header)
    await page.locator('form').getByRole('link', { name: /sign up/i }).click();
    await expect(page).toHaveURL(/\/en\/auth\/register/);

    // Click the "Sign In" link from the register form (not header)
    await page.locator('form').getByRole('link', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/en\/auth\/login/);
  });

  test('login form sign in button enables when fields are filled', async ({ page }) => {
    await page.goto('/en/auth/login');
    const signInButton = page.getByRole('button', { name: /sign in/i });

    // Initially disabled
    await expect(signInButton).toBeDisabled();

    // Fill in both fields — use click + pressSequentially for cross-browser compatibility
    await page.getByLabel(/email/i).click();
    await page.getByLabel(/email/i).pressSequentially('test@example.com');
    await page.getByLabel(/password/i).click();
    await page.getByLabel(/password/i).pressSequentially('Password123');

    // Now button should be enabled
    await expect(signInButton).toBeEnabled();

    // Click should not throw
    await signInButton.click();
  });

  test('register form submit button is visible', async ({ page }) => {
    await page.goto('/en/auth/register');
    const submitButton = page.getByRole('button', { name: /sign up/i });
    await expect(submitButton).toBeVisible();
    // Disabled when empty (by design)
    await expect(submitButton).toBeDisabled();
  });

  test('should redirect to login when accessing dashboard unauthenticated', async ({ page }) => {
    await page.goto('/en/dashboard');
    // Should redirect to login
    await expect(page).toHaveURL(/\/en\/auth\/login/, { timeout: 10000 });
  });

  test('header shows sign in/sign up links when not authenticated', async ({ page }) => {
    await page.goto('/en');
    const nav = page.getByRole('navigation');
    await expect(nav.getByRole('link', { name: /sign in/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /sign up/i })).toBeVisible();
  });
});
