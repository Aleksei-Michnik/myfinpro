import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E tests for staging environment.
 *
 * Run: pnpm --filter web test:e2e:staging
 *
 * Requires STAGING_URL env var (defaults to https://stage-myfin.michnik.pro)
 */
export default defineConfig({
  testDir: './e2e/staging',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report/staging' }]]
    : [['html', { open: 'on-failure', outputFolder: 'playwright-report/staging' }]],

  use: {
    baseURL: process.env.STAGING_URL || 'https://stage-myfin.michnik.pro',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Trust the staging SSL certificate
    ignoreHTTPSErrors: true,
  },

  // Only run Chromium in CI for speed; all browsers locally
  projects: process.env.CI
    ? [
        {
          name: 'chromium',
          use: { ...devices['Desktop Chrome'] },
        },
      ]
    : [
        {
          name: 'chromium',
          use: { ...devices['Desktop Chrome'] },
        },
        {
          name: 'firefox',
          use: { ...devices['Desktop Firefox'] },
        },
        {
          name: 'mobile-chrome',
          use: { ...devices['Pixel 5'] },
        },
      ],
});
