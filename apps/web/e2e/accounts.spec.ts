import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 20 · Iteration 20.3 — accounts happy path:
 * create a bank account and a card → place a transaction on the bank →
 * transfer bank → card → balances on /accounts and the dashboard → import a
 * statement (20.5) → review the queue → re-import (all duplicates) → edit →
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

/** A generic CSV statement, built at run time so its dates sit inside the match window. */
function statementCsv(): Buffer {
  const today = new Date().toISOString().slice(0, 10);
  const rows = [
    'Date,Description,Amount,Reference',
    `${today},SHUFERSAL DEAL,-100.00,1001`, // equals the spend placed on the bank
    `${today},SUPER-PHARM,-45.90,1002`,
    `${today},PAZ GAS STATION,-250.00,1003`,
    `${today},SALARY ACME LTD,12000.00,1004`,
    `${today},CAFE NIMROD,-18.00,1005`,
    `${today},AM:PM MARKET,-62.30,1006`,
  ];
  return Buffer.from(rows.join('\n'), 'utf8');
}

async function importStatement(page: Page, expectNew: boolean): Promise<void> {
  await expect(page.getByTestId('statement-import-dialog')).toBeVisible();
  await page
    .getByTestId('statement-file-input')
    .setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: statementCsv() });
  await expect(page.getByTestId('statement-file-name')).toContainText('statement.csv');
  await page.getByTestId('statement-import-continue').click();
  await expect(page.getByTestId('statement-import-step-2')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('statement-import-preset')).toContainText('CSV');
  await expect(page.getByTestId('statement-import-rows')).toHaveText('6');
  await page.getByTestId('statement-import-submit').click();
  await expect(page.getByTestId('statement-import-step-3')).toHaveAttribute(
    'aria-current',
    'step',
    {
      timeout: 20_000,
    },
  );
  if (expectNew) {
    await expect(page.getByTestId('statement-result-inserted')).toHaveText('6');
    await expect(page.getByTestId('statement-result-duplicates')).toHaveText('0');
  } else {
    await expect(page.getByTestId('statement-result-empty')).toBeVisible();
  }
}

test.describe('Accounts happy path (20.3 + 20.5)', () => {
  test.setTimeout(240_000);

  test('create → place → transfer → balances → import → review → edit → archive → delete', async ({
    page,
  }) => {
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

    // ── Import a statement on the bank (20.5) ─────────────────────────────
    await page.goto('/accounts');
    await expect(page.getByTestId(`account-card-${bankId}`)).toBeVisible({ timeout: 30_000 });
    await page.getByTestId(`account-actions-${bankId}`).click();
    await page.getByTestId(`account-import-${bankId}`).click();
    await expect(page.getByTestId('statement-import-account')).toBeDisabled();
    await importStatement(page, true);
    await page.getByTestId('statement-import-review-cta').click();

    // ── Review queue: six pending lines, decide by hand, undo, ignore ─────
    await expect(page).toHaveURL(new RegExp(`/accounts/${bankId}\\?tab=review`), {
      timeout: 30_000,
    });
    await expect(page.getByTestId('account-review-list')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('account-tab-review-count')).toHaveText('6');
    const rows = page.getByTestId('account-review-list').locator('[data-testid^="line-row-"]');
    await expect(rows).toHaveCount(6);
    const firstId = (await rows.first().getAttribute('data-testid'))!.replace('line-row-', '');
    // Create: every line needs a category the first time round.
    await page
      .getByTestId(`line-category-picker-${firstId}`)
      .getByTestId('category-picker-select')
      .selectOption({ index: 1 });
    await page.getByTestId(`line-accept-${firstId}`).click();
    await expect(page.getByTestId(`line-row-${firstId}`)).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId('account-review-undo')).toBeVisible();
    await expect(page.getByTestId('account-tab-review-count')).toHaveText('5', { timeout: 15_000 });
    // Undo brings it back.
    await page.getByTestId('account-review-undo-button').click();
    await expect(page.getByTestId(`line-row-${firstId}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('account-tab-review-count')).toHaveText('6', { timeout: 15_000 });
    // Ignore through the keyboard: focus the row, press I.
    await page.getByTestId(`line-row-${firstId}`).focus();
    await page.keyboard.press('i');
    await expect(page.getByTestId(`line-row-${firstId}`)).toBeHidden({ timeout: 15_000 });
    // The decided filter shows it with an undo action.
    await page.getByTestId('account-review-filter-decided').click();
    await expect(page.getByTestId(`line-undo-${firstId}`)).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('account-review-filter-all').click();
    await expect(rows).toHaveCount(5, { timeout: 15_000 });

    // ── Re-import the same file: nothing new ───────────────────────────────
    await page.getByTestId('account-detail-import').click();
    await importStatement(page, false);
    await page.getByTestId('statement-import-done').click();
    await page.getByTestId('account-tab-imports').click();
    // The tab renders a card list (phone) and a table (desktop) — count one rendering.
    await expect(page.locator('table tr[data-testid^="import-row-"]')).toHaveCount(2, {
      timeout: 15_000,
    });
    await page.getByTestId('account-tab-transactions').click();
    await expect(page.getByTestId('transactions-list')).toBeVisible({ timeout: 15_000 });

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
