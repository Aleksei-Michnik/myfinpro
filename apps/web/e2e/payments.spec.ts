import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 6 · Iteration 6.21 — payments happy paths (design acceptance:
 * one-time / recurring / loan).
 *
 * Requires a live stack (web + api + MySQL + Redis) — the same requirement
 * as the auth E2E flows. A fresh user is registered per run so the flow is
 * deterministic and repeatable against any environment.
 */

const PASSWORD = 'E2ePayments123!';

async function registerFreshUser(page: Page): Promise<string> {
  const email = `e2e-pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  await page.goto('/auth/register');
  await expect(page.locator('form')).toBeVisible();
  await page.getByLabel(/full name/i).fill('E2E Payments');
  await page.getByLabel(/email/i).fill(email);
  const passwordFields = page.locator('input[type="password"]');
  await passwordFields.nth(0).fill(PASSWORD);
  await passwordFields.nth(1).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /sign up/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  return email;
}

/** Open the add-payment dialog from /payments and fill the base fields. */
async function openDialogWithBaseFields(page: Page, amount: string) {
  await page.getByTestId('payments-list-add').click();
  await expect(page.getByTestId('form-amount')).toBeVisible();
  await page.getByTestId('form-amount').fill(amount);
  // Default direction OUT; pick the first real category option.
  await page.getByTestId('category-picker-select').selectOption({ index: 1 });
}

test.describe('Payments happy paths (6.21)', () => {
  test.setTimeout(240_000);

  test('one-time, recurring, and loan flows end-to-end', async ({ page }) => {
    await registerFreshUser(page);

    await page.goto('/payments');
    await expect(page.getByTestId('payments-list')).toBeVisible({ timeout: 30_000 });

    // ── 1. ONE_TIME ────────────────────────────────────────────────────────
    await openDialogWithBaseFields(page, '42.50');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('form-amount')).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId('payments-list-desktop').getByText('$42.50').first()).toBeVisible(
      { timeout: 15_000 },
    );

    // ── 2. RECURRING (schedule sub-form defaults: every 1 day) ────────────
    await openDialogWithBaseFields(page, '5.00');
    await page.getByTestId('type-disclosure-toggle').click();
    await page.getByTestId('type-radio-RECURRING').check();
    await expect(page.getByTestId('payment-schedule-subform')).toBeVisible();
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('form-amount')).toBeHidden({ timeout: 15_000 });
    // The catch-up worker may already have generated today's occurrence, so
    // the parent and a child can both show -$5.00 — assert at-least-one.
    await expect(page.getByTestId('payments-list-desktop').getByText('$5.00').first()).toBeVisible({
      timeout: 15_000,
    });

    // ── 3. LOAN — $10,000 @ 5% × 12 monthly payments ──────────────────────
    await openDialogWithBaseFields(page, '10000');
    await page.getByTestId('type-disclosure-toggle').click();
    await page.getByTestId('type-radio-LOAN').check();
    await expect(page.getByTestId('payment-plan-subform')).toBeVisible();
    await page.getByTestId('plan-rate').fill('5');
    await page.getByTestId('plan-count').fill('12');
    await page.getByTestId('plan-first-due').fill('2026-08-01');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('form-amount')).toBeHidden({ timeout: 20_000 });

    const loanRow = page
      .getByTestId('payments-list-desktop')
      .locator('[data-testid^="payment-row-"]')
      .filter({ hasText: '$10,000.00' })
      .first();
    await expect(loanRow).toBeVisible({ timeout: 15_000 });

    // ── 4. Loan detail: amortisation table renders all 12 rows ────────────
    await loanRow.click();
    await expect(page).toHaveURL(/\/payments\//, { timeout: 15_000 });
    await expect(page.getByTestId('plan-section')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('plan-status-pill')).toHaveText(/active/i);
    await expect(page.getByTestId('plan-table')).toBeVisible();
    await expect(
      page.locator('[data-testid^="plan-row-"]:not([data-testid*="status"])'),
    ).toHaveCount(12);
    // Reference annuity for $10,000 @ 5% × 12 → $856.07/month.
    await expect(page.getByTestId('plan-row-1')).toContainText('$856.07');
    await expect(page.getByTestId('plan-row-status-1')).toHaveText(/pending/i);

    // ── 5. Cancel the plan (terminal, two-step confirm) ───────────────────
    await page.getByTestId('plan-action-cancel').click();
    await page.getByTestId('plan-cancel-confirm-yes').click();
    await expect(page.getByTestId('plan-status-pill')).toHaveText(/cancelled/i, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('plan-row-status-1')).toHaveText(/cancelled/i);
    await expect(page.getByTestId('plan-actions')).toBeHidden();
  });
});
