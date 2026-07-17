'use client';

// Phase 10 · Iteration 10.3 — the "New budget" entry point (design §7).
// Thin wrapper pinning <BudgetFormDialog> to create mode (POST /budgets);
// the edit flavour is wired by the /budgets cards in 10.4.

import type { AttributionScope } from '@myfinpro/shared';
import { BudgetFormDialog } from './BudgetFormDialog';
import type { BudgetSummary } from '@/lib/budget/types';
import type { CategoryDto } from '@/lib/transaction/types';

export interface CreateBudgetDialogProps {
  open: boolean;
  /** Pins for hosts that already know the scope (e.g. a group page, 10.7). */
  defaults?: Partial<{
    scope: AttributionScope;
    currency: string;
    categoryId: string;
  }>;
  onClose(): void;
  onCreated(budget: BudgetSummary): void;
  /** Optional shared categories list. */
  categories?: CategoryDto[] | null;
}

export function CreateBudgetDialog({
  open,
  defaults,
  onClose,
  onCreated,
  categories,
}: CreateBudgetDialogProps) {
  return (
    <BudgetFormDialog
      open={open}
      mode="create"
      defaults={defaults}
      onClose={onClose}
      onSaved={onCreated}
      categories={categories}
    />
  );
}
