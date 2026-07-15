'use client';

// Phase 6 · Iteration 6.15 — primary "+ Add transaction" button for the
// aggregated dashboard. Owns the open/close state of `<TransactionFormDialog>`
// so the dashboard parent only needs an `onTransactionCreated` callback.

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { TransactionFormDialog } from '@/components/transaction/TransactionFormDialog';
import { Button } from '@/components/ui/Button';
import type { TransactionSummary } from '@/lib/transaction/types';

export interface QuickAddTransactionButtonProps {
  onTransactionCreated?(transaction: TransactionSummary): void;
}

export function QuickAddTransactionButton({
  onTransactionCreated,
}: QuickAddTransactionButtonProps) {
  const t = useTranslations('dashboard.actions');
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="primary"
        size="md"
        onClick={() => setOpen(true)}
        data-testid="quick-add-transaction-button"
      >
        {t('add')}
      </Button>
      {open && (
        <TransactionFormDialog
          open
          mode="create"
          onClose={() => setOpen(false)}
          onSaved={(transaction) => {
            if (transaction) onTransactionCreated?.(transaction);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
