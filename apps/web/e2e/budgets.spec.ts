import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 10 · Iteration 10.4 — budgets list happy path
 * (create → card → edit → archive → show archived → unarchive → delete).
 *
 * Requires a live stack (web + api + MySQL + Redis) — the same requirement
 * as the auth/payments/receipts E2E flows. A fresh user is registered per
 * run so the flow is deterministic and repeatable against any environment.
 */

const PASSWORD = 'E2eBudgets123!';

async function registerFreshUser(page: Page): Promise<void> {
  const email = `e2e-bdgt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  await page.goto('/auth/register');
  await expect(page.locator('form')).toBeVisible();
  await page.getByLabel(/full name/i).fill('E2E Budgets');
  await page.getByLabel(/email/i).fill(email);
  const passwordFields = page.locator('input[type="password"]');
  await passwordFields.nth(0).fill(PASSWORD);
  await passwordFields.nth(1).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /sign up/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

/** Open a budget card's ⋮ menu and click one of its actions. */
async function clickCardAction(page: Page, action: 'edit' | 'archive' | 'delete') {
  const card = page.locator('[data-testid^="budget-card-"]').first();
  const id = (await card.getAttribute('data-testid'))!.replace('budget-card-', '');
  await page.getByTestId(`budget-actions-${id}`).click();
  await page.getByTestId(`budget-${action}-${id}`).click();
}

test.describe('Budgets happy path (10.4)', () => {
  test.setTimeout(180_000);

  test('create → card → edit → archive → unarchive → delete', async ({ page }) => {
    await registerFreshUser(page);

    await page.goto('/budgets');
    await expect(page.getByTestId('budgets-page')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('budgets-empty')).toBeVisible({ timeout: 15_000 });

    // ── Create ────────────────────────────────────────────────────────────
    await page.getByTestId('budgets-new').click();
    await expect(page.getByTestId('budget-form-dialog')).toBeVisible();
    await page.getByTestId('budget-form-name').fill('Groceries');
    await page.getByTestId('budget-form-amount').fill('800');
    await page.getByTestId('budget-form-save').click();
    await expect(page.getByTestId('budget-form-dialog')).toBeHidden({ timeout: 15_000 });

    const card = page.locator('[data-testid^="budget-card-"]').first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText('Groceries');
    await expect(card).toContainText('$800.00');

    // ── Edit ──────────────────────────────────────────────────────────────
    await clickCardAction(page, 'edit');
    await expect(page.getByTestId('budget-form-dialog')).toBeVisible();
    await page.getByTestId('budget-form-name').fill('Groceries & more');
    await page.getByTestId('budget-form-save').click();
    await expect(page.getByTestId('budget-form-dialog')).toBeHidden({ timeout: 15_000 });
    await expect(card).toContainText('Groceries & more', { timeout: 15_000 });

    // ── Archive — the card drops out of the default (hide-archived) list ──
    await clickCardAction(page, 'archive');
    await expect(page.getByTestId('budgets-empty')).toBeVisible({ timeout: 15_000 });

    // ── Show archived → the card is back, marked archived ─────────────────
    await page.getByTestId('budgets-archived-toggle').click();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toHaveAttribute('data-archived', 'true');

    // ── Unarchive ─────────────────────────────────────────────────────────
    await clickCardAction(page, 'archive');
    await expect(card).not.toHaveAttribute('data-archived', 'true', { timeout: 15_000 });

    // ── Delete (confirmed) ────────────────────────────────────────────────
    await clickCardAction(page, 'delete');
    await expect(page.getByTestId('confirm-dialog')).toBeVisible();
    await page.getByTestId('confirm-dialog-confirm').click();
    await expect(page.getByTestId('budgets-empty')).toBeVisible({ timeout: 15_000 });
  });
});
