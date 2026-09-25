import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 20 · Iteration 20.7 — connector tokens happy path
 * (create → reveal shows the `mfp_…` secret and both connector commands →
 * copy → the row lists it → revoke → back to empty).
 *
 * Requires a live stack (web + api + MySQL + Redis) — the same requirement
 * as the accounts/budgets E2E flows. A fresh user is registered per run so
 * the flow is deterministic and repeatable against any environment.
 */

const PASSWORD = 'E2eTokens123!';

async function registerFreshUser(page: Page): Promise<void> {
  const email = `e2e-tok-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  await page.goto('/auth/register');
  await expect(page.locator('form')).toBeVisible();
  await page.getByLabel(/full name/i).fill('E2E Tokens');
  await page.getByLabel(/email/i).fill(email);
  const passwordFields = page.locator('input[type="password"]');
  await passwordFields.nth(0).fill(PASSWORD);
  await passwordFields.nth(1).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /sign up/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

test.describe('Connector tokens happy path (20.7)', () => {
  test.setTimeout(120_000);

  test('create → reveal → copy → list → revoke', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await registerFreshUser(page);

    // ── Entry point: the settings/account "more settings" link ───────────
    await page.goto('/settings/account');
    await expect(page.getByTestId('settings-tokens-link')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('settings-tokens-link').click();

    await expect(page).toHaveURL(/\/settings\/tokens/, { timeout: 30_000 });
    await expect(page.getByTestId('tokens-page')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('tokens-empty')).toBeVisible({ timeout: 15_000 });

    // ── Create a token ─────────────────────────────────────────────────
    await page.getByTestId('tokens-new').click();
    await expect(page.getByTestId('token-create-dialog')).toBeVisible();
    await page.getByTestId('token-form-name').fill('E2E laptop connector');
    await page.getByTestId('token-form-submit').click();

    // ── The show-once reveal: the raw secret and both commands ──────────
    await expect(page.getByTestId('token-reveal')).toBeVisible({ timeout: 15_000 });
    const revealedValue = await page.getByTestId('token-reveal-value').inputValue();
    expect(revealedValue).toMatch(/^mfp_/);
    const commands = await page.getByTestId('token-reveal-commands').inputValue();
    expect(commands).toContain('node apps/connector/dist/main.js init');
    expect(commands).toContain('node apps/connector/dist/main.js sync');

    // ── Copy actually reaches the clipboard ──────────────────────────────
    await page.getByTestId('token-reveal-copy').click();
    await expect(page.getByTestId('token-reveal-status')).toHaveText(/./, { timeout: 5_000 });
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(revealedValue);

    // ── Done: the secret leaves the DOM, the row appears ─────────────────
    await page.getByTestId('token-reveal-done').click();
    await expect(page.getByTestId('token-create-dialog')).toBeHidden({ timeout: 15_000 });
    await expect(page.locator(`text=${revealedValue}`)).toHaveCount(0);

    const row = page.locator('[data-testid^="token-row-"]').first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    const rowId = (await row.getAttribute('data-testid'))!.replace('token-row-', '');
    await expect(page.getByTestId(`token-name-${rowId}`)).toHaveText('E2E laptop connector');
    await expect(page.getByTestId(`token-scope-${rowId}`)).toContainText('Import statement lines');

    // ── Revoke ────────────────────────────────────────────────────────────
    await page.getByTestId(`token-revoke-${rowId}`).click();
    await expect(page.getByTestId('confirm-dialog')).toBeVisible();
    await page.getByTestId('confirm-dialog-confirm').click();
    await expect(page.getByTestId(`token-row-${rowId}`)).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId('tokens-empty')).toBeVisible({ timeout: 15_000 });
  });
});
