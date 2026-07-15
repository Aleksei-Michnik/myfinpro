'use client';

// Phase 6 · Iteration 6.15 — primary "+ Add payment" button for the
// aggregated dashboard. Owns the open/close state of `<PaymentFormDialog>`
// so the dashboard parent only needs an `onPaymentCreated` callback.

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { PaymentFormDialog } from '@/components/payment/PaymentFormDialog';
import { Button } from '@/components/ui/Button';
import type { PaymentSummary } from '@/lib/payment/types';

export interface QuickAddPaymentButtonProps {
  onPaymentCreated?(payment: PaymentSummary): void;
}

export function QuickAddPaymentButton({ onPaymentCreated }: QuickAddPaymentButtonProps) {
  const t = useTranslations('dashboard.actions');
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="primary"
        size="md"
        onClick={() => setOpen(true)}
        data-testid="quick-add-payment-button"
      >
        {t('add')}
      </Button>
      {open && (
        <PaymentFormDialog
          open
          mode="create"
          onClose={() => setOpen(false)}
          onSaved={(payment) => {
            if (payment) onPaymentCreated?.(payment);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
