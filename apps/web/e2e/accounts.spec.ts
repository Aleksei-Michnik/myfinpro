import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 20 · Iteration 20.3 — accounts happy path:
 * create a bank account and a card → place a transaction on the bank →
 * transfer bank → card → balances on /accounts and the dashboard → edit →
 * archive → delete.
 *
 * Requires a live stack (web + api + MySQL + Redis). A fresh user is
 * registered per run so the flow is deterministic against any environment.
 */

const PASSWORD = 'E2eAccounts123!';

async function registerFreshUser(page: Page): Promise<void> {
  const email = `e2e-acct-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  await page.goto('/auth/register');
  await expect(page.locator('form')).toBeVisible();
  await page.getByLabel(/full name/i).fill('E2E Accounts');
  await page.getByLabel(/email/i).fill(email);
  const passwordFields = page.locator('input[type="password"]');
  await passwordFields.nth(0).fill(PASSWORD);
  await passwordFields.nth(1).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /sign up/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

async function createAccount(
  page: Page,
  fields: { name: string; kind: 'BANK' | 'CARD' | 'CASH' | 'OTHER'; opening?: string },
): Promise<string> {
  await page.getByTestId('accounts-new').click();
  await expect(page.getByTestId('account-form-dialog')).toBeVisible();
  await page.getByTestId('account-form-name').fill(fields.name);
  await page.getByTestId('account-form-kind').selectOption(fields.kind);
  if (fields.opening) {
    await page.getByTestId('account-form-opening-amount').fill(fields.opening);
    await page.getByTestId('account-form-opening-date').fill('2026-01-01');
  }
  await page.getByTestId('account-form-save').click();
  await expect(page.getByTestId('account-form-dialog')).toBeHidden({ timeout: 15_000 });
  const card = page.locator('[data-testid^="account-card-"]', { hasText: fields.name }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  return (await card.getAttribute('data-testid'))!.replace('account-card-', '');
}

async function clickCardAction(page: Page, id: string, action: 'edit' | 'archive' | 'delete') {
  await page.getByTestId(`account-actions-${id}`).click();
  await page.getByTestId(`account-${action}-${id}`).click();
}

test.describe('Accounts happy path (20.3)', () => {
  test.setTimeout(240_000);

  test('create → place → transfer → balances → edit → archive → delete', async ({ page }) => {
    await registerFreshUser(page);

    await page.goto('/accounts');
    await expect(page.getByTestId('accounts-page')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('accounts-empty')).toBeVisible({ timeout: 15_000 });

    // ── Create a bank account with an opening balance and a card ─────────
    const bankId = await createAccount(page, { name: 'Checking', kind: 'BANK', opening: '1000' });
    await expect(page.getByTestId(`account-ledger-${bankId}`)).toContainText('1,000.00');
    const cardId = await createAccount(page, { name: 'Visa', kind: 'CARD' });

    // ── A spend placed on the bank moves its balance ──────────────────────
    await page.goto('/transactions');
    await page.getByTestId('transactions-list-add').click();
    await expect(page.getByTestId('form-amount')).toBeVisible();
    await page.getByTestId('form-direction-out').click();
    await page.getByTestId('form-amount').fill('100');
    await page.getByTestId('form-account').selectOption(bankId);
    // Pick the first category offered for OUT.
    await page.getByTestId('category-picker-select').selectOption({ index: 1 });
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('form-amount')).toBeHidden({ timeout: 15_000 });
    const spendRow = page.locator('[data-testid^="transaction-row-"]').first();
    await expect(spendRow).toBeVisible({ timeout: 15_000 });
    await expect(spendRow.locator('[data-testid^="row-account-"]')).toContainText('Checking');

    // ── A transfer bank → card counts in neither spend total ──────────────
    await page.getByTestId('transactions-list-add').click();
    await expect(page.getByTestId('form-amount')).toBeVisible();
    await page.getByTestId('form-amount').fill('250');
    await page.getByTestId('form-account').selectOption(bankId);
    await page.getByTestId('form-transfer-toggle').check();
    await expect(page.getByTestId('form-direction-out')).toBeHidden();
    await page.getByTestId('form-transfer-to').selectOption(cardId);
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('form-amount')).toBeHidden({ timeout: 15_000 });
    const transferRow = page.locator('[data-testid^="row-transfer-"]').first();
    await expect(transferRow).toContainText('Visa', { timeout: 15_000 });

    // ── Balances: bank 1000 − 100 − 250 = 650; card owed 0 + 250 ─────────
    await page.goto('/accounts');
    await expect(page.getByTestId(`account-ledger-${bankId}`)).toContainText('650.00', {
      timeout: 30_000,
    });
    await expect(page.getByTestId(`account-ledger-${cardId}`)).toContainText('250.00');

    await page.goto('/dashboard');
    await expect(page.getByTestId('accounts-overview-rows')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`accounts-overview-row-${bankId}`)).toContainText('650.00');

    // ── The account filter narrows the list to both sides of the transfer ─
    await page.goto(`/transactions?accountId=${cardId}`);
    // The list renders a card and a table row per transaction — count one rendering.
    await expect(
      page.getByTestId('transactions-list-desktop').locator('[data-testid^="transaction-row-"]'),
    ).toHaveCount(1, { timeout: 30_000 });

    // ── Edit → archive → delete ──────────────────────────────────────────
    await page.goto('/accounts');
    await expect(page.getByTestId(`account-card-${cardId}`)).toBeVisible({ timeout: 30_000 });
    await clickCardAction(page, cardId, 'edit');
    await expect(page.getByTestId('account-form-dialog')).toBeVisible();
    await page.getByTestId('account-form-name').fill('Visa Gold');
    await page.getByTestId('account-form-save').click();
    await expect(page.getByTestId('account-form-dialog')).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId(`account-name-${cardId}`)).toHaveText('Visa Gold', {
      timeout: 15_000,
    });

    await clickCardAction(page, cardId, 'archive');
    await expect(page.getByTestId(`account-card-${cardId}`)).toBeHidden({ timeout: 15_000 });
    await page.getByTestId('accounts-archived-toggle').click();
    await expect(page.getByTestId(`account-card-${cardId}`)).toHaveAttribute(
      'data-archived',
      'true',
      { timeout: 15_000 },
    );

    await clickCardAction(page, cardId, 'delete');
    await expect(page.getByTestId('confirm-dialog')).toBeVisible();
    await page.getByTestId('confirm-dialog-confirm').click();
    await expect(page.getByTestId(`account-card-${cardId}`)).toBeHidden({ timeout: 15_000 });
    // The bank account is still there with its balance.
    await expect(page.getByTestId(`account-card-${bankId}`)).toBeVisible();
  });
});
