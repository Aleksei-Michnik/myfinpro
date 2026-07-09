import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 7 · Iteration 7.10 — receipt lifecycle happy path
 * (upload → extract → review → confirm → payment).
 *
 * Requires a live stack (web + api + MySQL + Redis) with the extraction
 * provider set to `mock` (RECEIPT_EXTRACTION_PROVIDER=mock) — the mock
 * yields a deterministic "Mock Grocery" / $16.60 receipt so the flow is
 * repeatable against any environment. A fresh user is registered per run.
 */

const PASSWORD = 'E2eReceipts123!';

// Minimal valid 1×1 PNG — passes the API's magic-byte validation.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function registerFreshUser(page: Page): Promise<void> {
  const email = `e2e-rcpt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  await page.goto('/auth/register');
  await expect(page.locator('form')).toBeVisible();
  await page.getByLabel(/full name/i).fill('E2E Receipts');
  await page.getByLabel(/email/i).fill(email);
  const passwordFields = page.locator('input[type="password"]');
  await passwordFields.nth(0).fill(PASSWORD);
  await passwordFields.nth(1).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /sign up/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

test.describe('Receipts happy path (7.10)', () => {
  test.setTimeout(180_000);

  test('upload → extract → review → confirm → payment', async ({ page }) => {
    await registerFreshUser(page);

    await page.goto('/receipts');
    await expect(page.getByTestId('receipts-list')).toBeVisible({ timeout: 30_000 });

    // ── Upload ────────────────────────────────────────────────────────────
    await page.getByTestId('receipt-file-input').setInputFiles({
      name: 'receipt.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    });

    // A row appears immediately (UPLOADED) and reaches REVIEW once the mock
    // extraction worker finishes.
    const firstRow = page.locator('[data-testid^="receipt-row-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 30_000 });
    await expect(firstRow.locator('[data-status="REVIEW"]')).toBeVisible({ timeout: 60_000 });

    // ── Review ────────────────────────────────────────────────────────────
    await firstRow.locator('[data-testid^="receipt-link-"]').click();
    await expect(page.getByTestId('review-merchant')).toHaveValue('Mock Grocery', {
      timeout: 30_000,
    });
    // Mock total is $16.60.
    await expect(page.getByTestId('review-total')).toHaveValue('16.60');

    // ── Confirm ───────────────────────────────────────────────────────────
    await expect(page.getByTestId('review-confirm')).toBeEnabled();
    await page.getByTestId('review-confirm').click();
    await expect(page.getByTestId('receipt-confirm-dialog')).toBeVisible();

    // Primary category — pick the first real option.
    await page.getByTestId('category-picker-select').selectOption({ index: 1 });
    await page.getByTestId('receipt-confirm-submit').click();

    // Lands on the new payment's detail page.
    await expect(page).toHaveURL(/\/payments\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await expect(page.getByText('$16.60').first()).toBeVisible({ timeout: 15_000 });
  });
});
