'use client';

// Phase 8 · Iteration 8.15 — attach a receipt to an existing transaction
// (design §3). Offers the LLM-analysed intake paths — photograph, browse,
// drop, e-receipt URL — since the whole point is to extract the receipt and
// reconcile it against the transaction (a manually-composed barcode receipt
// has nothing to analyse). The receipt is created already linked to the
// transaction; the review page then runs reconciliation.
//
// 8.29 — the intake itself is the shared `ReceiptIntake`: this dialog is the
// sheet around it plus the "link an existing receipt" handoff.

import { useTranslations } from 'next-intl';
import { ReceiptIntake } from './ReceiptIntake';
import { Dialog } from '@/components/ui/Dialog';
import type { ReceiptSummary } from '@/lib/receipt/types';

export interface AttachReceiptDialogProps {
  open: boolean;
  transactionId: string;
  onClose(): void;
  /** The created (linked) receipt — the parent routes to its review. */
  onAttached(receipt: ReceiptSummary): void;
  /**
   * 8.28 — switch to the "link an existing receipt" picker. When provided a
   * third option is offered; the parent swaps this dialog for LinkReceiptDialog.
   */
  onLinkExisting?(): void;
}

export function AttachReceiptDialog({
  open,
  transactionId,
  onClose,
  onAttached,
  onLinkExisting,
}: AttachReceiptDialogProps) {
  const t = useTranslations('receipts.attach');

  if (!open || typeof document === 'undefined') return null;

  return (
    <Dialog
      open
      onClose={onClose}
      variant="sheet"
      title={t('title')}
      titleId="attach-receipt-title"
      testId="attach-receipt-dialog"
      backdropTestId="attach-receipt-backdrop"
      closeTestId="attach-receipt-close"
    >
      <ReceiptIntake
        target={{ kind: 'transaction', transactionId }}
        hint={t('hint')}
        testIdPrefix="attach-receipt"
        onCreated={(receipts) => {
          const attached = receipts[0];
          if (attached) onAttached(attached);
        }}
        onLinkExisting={onLinkExisting}
      />
    </Dialog>
  );
}
