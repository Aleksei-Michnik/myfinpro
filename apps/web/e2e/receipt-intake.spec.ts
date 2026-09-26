import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 8 · Iteration 8.29 — the shared `ReceiptIntake` block as mounted by
 * its two non-`/receipts` hosts (docs/ui/8.29-receipt-intake.md): the "From
 * receipt" block inside the create-transaction form, and the "Attach
 * receipt" sheet on a transaction's detail page. `apps/web/e2e/receipts.spec.ts`
 * covers the `/receipts` page host (`receipt-*` ids) end to end already.
 *
 * Requires a live stack (web + api + MySQL + Redis) with the extraction
 * provider set to `mock` (RECEIPT_EXTRACTION_PROVIDER=mock). A fresh user is
 * registered per test.
 */

const PASSWORD = 'E2eIntake1!';

// Minimal valid 1x1 PNG — passes the API's magic-byte validation.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function registerFreshUser(page: Page): Promise<void> {
  const email = `e2e-intake-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  await page.goto('/auth/register');
  await expect(page.locator('form')).toBeVisible();
  await page.getByLabel(/full name/i).fill('E2E Intake');
  await page.getByLabel(/email/i).fill(email);
  const passwordFields = page.locator('input[type="password"]');
  await passwordFields.nth(0).fill(PASSWORD);
  await passwordFields.nth(1).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /sign up/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

/** A saved OUT (expense) transaction — the only kind that offers "Attach receipt". */
async function createOutTransaction(page: Page, note: string): Promise<void> {
  await page.goto('/transactions');
  await page.getByTestId('transactions-list-add').click();
  await expect(page.getByTestId('transaction-form-dialog')).toBeVisible();
  await page.getByTestId('form-direction-out').click();
  await page.getByTestId('form-amount').fill('12.34');
  await page.getByTestId('category-picker-select').selectOption({ index: 1 });
  await page.getByTestId('form-note').fill(note);
  await page.getByTestId('form-save').click();
  await expect(page.getByTestId('transaction-form-dialog')).toBeHidden({ timeout: 15_000 });
}

test.describe('Receipt intake — transaction form and attach sheet (8.29)', () => {
  test.setTimeout(180_000);

  test('from-receipt block: barcodes dialog, then a picked file routes to review and closes the dialog', async ({
    page,
  }) => {
    await registerFreshUser(page);

    await page.goto('/transactions');
    await page.getByTestId('transactions-list-add').click();
    await expect(page.getByTestId('transaction-form-from-receipt')).toBeVisible();

    // The host's extra method — opens the barcode composer, not a file pick.
    await page.getByTestId('transaction-form-receipt-barcodes').click();
    await expect(page.getByTestId('manual-receipt-dialog')).toBeVisible();
    await page.getByTestId('manual-receipt-close').click();
    await expect(page.getByTestId('manual-receipt-dialog')).toBeHidden();

    await page.getByTestId('transaction-form-receipt-file-input').setInputFiles({
      name: 'receipt.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    });

    await expect(page).toHaveURL(/\/receipts\/[0-9a-f-]{36}/, { timeout: 15_000 });
    await expect(page.getByTestId('transaction-form-dialog')).toHaveCount(0);
  });

  test('from-receipt block: Enter in the URL field never submits the transaction form', async ({
    page,
  }) => {
    await registerFreshUser(page);

    await page.goto('/transactions');
    await page.getByTestId('transactions-list-add').click();
    await expect(page.getByTestId('transaction-form-dialog')).toBeVisible();

    await page.getByTestId('transaction-form-receipt-url-toggle').click();
    await expect(page.getByTestId('transaction-form-receipt-url-input')).toBeFocused();

    // Empty value — submitUrl no-ops, but preventDefault must still run, so
    // the surrounding transaction form is never submitted by this Enter.
    await page.getByTestId('transaction-form-receipt-url-input').press('Enter');
    await expect(page.getByTestId('transaction-form-dialog')).toBeVisible();
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(page.getByTestId('form-api-error')).toHaveCount(0);

    // A real value — the dialog must still be there immediately after Enter
    // (proves no synchronous form submit; the async receipt create is separate).
    await page.getByTestId('transaction-form-receipt-url-input').fill('https://shop.example/r/9');
    await page.getByTestId('transaction-form-receipt-url-input').press('Enter');
    await expect(page.getByTestId('transaction-form-dialog')).toBeVisible();
  });

  test('attach sheet: offers link-existing, and a picked receipt lands linked on review', async ({
    page,
  }) => {
    await registerFreshUser(page);
    await createOutTransaction(page, 'e2e attach flow');

    const row = page
      .locator('[data-testid="transactions-list-desktop"] [data-testid^="transaction-row-"]')
      .first();
    await row.click();

    await expect(page.getByTestId('transaction-attach-receipt')).toBeVisible();
    await page.getByTestId('transaction-attach-receipt').click();

    await expect(page.getByTestId('attach-receipt-dialog')).toBeVisible();
    await expect(page.getByTestId('attach-receipt-intake')).toBeVisible();
    await expect(page.getByTestId('attach-receipt-link-existing')).toBeVisible();

    await page.getByTestId('attach-receipt-file-input').setInputFiles({
      name: 'receipt.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    });

    // Linked — lands on the receipt's own review page.
    await expect(page).toHaveURL(/\/receipts\/[0-9a-f-]{36}/, { timeout: 15_000 });
  });
});
