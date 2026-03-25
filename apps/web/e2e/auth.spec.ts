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

    // Wait for the form to be fully rendered before interacting
    await expect(page.locator('form')).toBeVisible();

    // Click the "Sign Up" link from the login form (not header)
    const signUpLink = page.locator('form').getByRole('link', { name: /sign up/i });
    await expect(signUpLink).toBeVisible();
    await signUpLink.click();
    await expect(page).toHaveURL(/\/en\/auth\/register/, { timeout: 10000 });

    // Wait for the register form to be fully rendered
    await expect(page.locator('form')).toBeVisible();

    // Click the "Sign In" link from the register form (not header)
    const signInLink = page.locator('form').getByRole('link', { name: /sign in/i });
    await expect(signInLink).toBeVisible();
    await signInLink.click();
    await expect(page).toHaveURL(/\/en\/auth\/login/, { timeout: 10000 });
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

  test('should stay signed in after page refresh (silent refresh)', async ({ page }) => {
    // Track whether user has "logged in" via mock
    let isLoggedIn = false;

    const mockUser = {
      id: 'test-uuid',
      email: 'test@example.com',
      name: 'Test User',
      defaultCurrency: 'USD',
      locale: 'en',
    };

    // Mock refresh endpoint — returns 401 until login succeeds
    await page.route('**/api/v1/auth/refresh', async (route) => {
      if (isLoggedIn) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ user: mockUser, accessToken: 'refreshed-token' }),
        });
      } else {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'No refresh token provided' }),
        });
      }
    });

    // Mock login endpoint
    await page.route('**/api/v1/auth/login', async (route) => {
      isLoggedIn = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: mockUser, accessToken: 'mock-access-token' }),
      });
    });

    // Mock logout (in case it fires during cleanup)
    await page.route('**/api/v1/auth/logout', async (route) => {
      isLoggedIn = false;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Logged out successfully' }),
      });
    });

    // 1. Go to login page
    await page.goto('/en/auth/login');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();

    // 2. Fill in credentials and submit
    await page.getByLabel(/email/i).click();
    await page.getByLabel(/email/i).pressSequentially('test@example.com');
    await page.getByLabel(/password/i).click();
    await page.getByLabel(/password/i).pressSequentially('Password123');
    await page.getByRole('button', { name: /sign in/i }).click();

    // 3. Should redirect to dashboard
    await expect(page).toHaveURL(/\/en\/dashboard/, { timeout: 15000 });

    // 4. Should show authenticated user in header (desktop only — hidden on mobile)
    const userNameEl = page.getByTestId('user-name');
    // On mobile projects the element is hidden via CSS; check logout button instead
    const logoutButton = page.getByRole('button', { name: /logout/i });
    await expect(logoutButton).toBeVisible({ timeout: 5000 });

    // 5. Reload the page — silent refresh should restore the session
    await page.reload();

    // 6. Should still be on dashboard (not redirected to login)
    await expect(page).toHaveURL(/\/en\/dashboard/, { timeout: 15000 });

    // 7. Authenticated UI should still be visible
    await expect(logoutButton).toBeVisible({ timeout: 5000 });
  });

  test('Google sign-in button is enabled and navigates to OAuth endpoint', async ({ page }) => {
    await page.goto('/en/auth/login');

    // Wait for form to load
    await expect(page.locator('form')).toBeVisible();

    const googleBtn = page.getByRole('button', { name: /google/i });
    await expect(googleBtn).toBeVisible();
    await expect(googleBtn).toBeEnabled();

    // Intercept navigation to verify Google OAuth URL
    const [request] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('/api/v1/auth/google')),
      googleBtn.click(),
    ]);
    expect(request.url()).toContain('/api/v1/auth/google');
  });

  test('OAuth callback page with valid token shows loading then redirects to dashboard', async ({
    page,
  }) => {
    const mockUser = {
      id: 'google-user-uuid',
      email: 'google@example.com',
      name: 'Google User',
      defaultCurrency: 'USD',
      locale: 'en',
    };

    // Mock /auth/me endpoint to return user profile for the token
    await page.route('**/api/v1/auth/me', async (route) => {
      const headers = route.request().headers();
      if (headers['authorization'] === 'Bearer valid-google-token') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockUser),
        });
      } else {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Unauthorized' }),
        });
      }
    });

    // Mock refresh to also return authenticated user (for post-redirect)
    await page.route('**/api/v1/auth/refresh', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: mockUser, accessToken: 'valid-google-token' }),
      });
    });

    await page.goto('/en/auth/callback?token=valid-google-token');

    // Should show loading spinner initially
    await expect(page.getByText(/signing in with google/i)).toBeVisible({ timeout: 5000 });

    // Should eventually redirect to dashboard
    await expect(page).toHaveURL(/\/en\/dashboard/, { timeout: 15000 });
  });

  test('OAuth callback page without token redirects to login', async ({ page }) => {
    // Mock refresh as unauthenticated
    await page.route('**/api/v1/auth/refresh', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Unauthorized' }),
      });
    });

    await page.goto('/en/auth/callback');

    // Should redirect to login page
    await expect(page).toHaveURL(/\/en\/auth\/login/, { timeout: 15000 });
  });
});
