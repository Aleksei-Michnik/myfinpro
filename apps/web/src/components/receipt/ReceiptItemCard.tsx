'use client';

// Phase 8 · Iteration 8.24 — one card per receipt line item (design §2.2),
// replacing the old grid-cols-12 row at every viewport width. Controlled and
// presentational: all state stays in the review client (`ItemRow` strings +
// `setItem`); the card only renders and reports edits. Unit price and
// discount become visible/editable for the first time — both advisory, the
// line total stays authoritative (the totals-mismatch warning is the
// parent's).

import { useTranslations } from 'next-intl';
import { ProductThumb } from '@/components/product/ProductThumb';
import { inputClass } from '@/components/ui/input-styles';
import type { ReceiptItem } from '@/lib/receipt/types';
import type { CategoryDto } from '@/lib/transaction/types';

/** String-typed editing state of one line (the parseMoney/centsToStr convention). */
export interface ItemRow {
  rawName: string;
  quantityStr: string;
  unitPriceStr: string;
  discountStr: string;
  totalStr: string;
  categoryId: string | null;
}

export interface ReceiptItemCardProps {
  index: number;
  row: ItemRow;
  /** Server-truth match state — absent while unsaved edits may desync indices. */
  serverItem?: ReceiptItem;
  editable: boolean;
  /** REVIEW/CONFIRMED — the registry chip opens the match dialog. */
  matchable: boolean;
  categories: Pick<CategoryDto, 'id' | 'name'>[];
  currency: string | null;
  onChange(patch: Partial<ItemRow>): void;
  onRemove(): void;
  onOpenMatch(itemId: string): void;
}

const labelClass = 'flex flex-col text-xs text-gray-500 dark:text-gray-400';

export function ReceiptItemCard({
  index,
  row,
  serverItem,
  editable,
  matchable,
  categories,
  currency,
  onChange,
  onRemove,
  onOpenMatch,
}: ReceiptItemCardProps) {
  const t = useTranslations('receipts.review');
  // Money fields carry the receipt currency in their label — the inputs
  // themselves stay plain decimal strings.
  const moneyLabel = (label: string) => (currency ? `${label} (${currency})` : label);

  return (
    <div
      className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40"
      data-testid={`receipt-item-card-${index}`}
    >
      {/* Header: thumbnail + name (match dot beside it, registry chip under) + remove. */}
      <div className="flex items-start gap-2">
        <ProductThumb item={serverItem} sizeClass="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <label className={labelClass}>
            <span>{t('itemName')}</span>
            <span className="flex items-center gap-1.5">
              {serverItem && (
                <span
                  aria-label={t(`matchState.${serverItem.matchStatus.toLowerCase()}`)}
                  title={
                    serverItem.productName ??
                    t(`matchState.${serverItem.matchStatus.toLowerCase()}`)
                  }
                  data-testid={`item-match-${index}`}
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    serverItem.matchStatus === 'CONFIRMED'
                      ? 'bg-green-500'
                      : serverItem.matchStatus === 'AUTO'
                        ? 'bg-blue-500'
                        : serverItem.matchStatus === 'SKIPPED'
                          ? 'bg-gray-300 dark:bg-gray-600'
                          : 'bg-amber-400'
                  }`}
                />
              )}
              <input
                type="text"
                value={row.rawName}
                onChange={(e) => onChange({ rawName: e.target.value })}
                disabled={!editable}
                data-testid={`item-name-${index}`}
                className={inputClass}
              />
            </span>
          </label>
          {/* 8.23 — the registry identity of the line: official name once
              matched, the printed code / match affordance until then. Opens
              the match dialog on this exact item. */}
          {serverItem && matchable && (
            <button
              type="button"
              onClick={() => onOpenMatch(serverItem.id)}
              aria-label={
                serverItem.productName
                  ? t('itemEditMatch', { name: serverItem.productName })
                  : t('itemMatchAction')
              }
              data-testid={`item-product-${index}`}
              className="mt-0.5 flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-start text-xs hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-600 dark:hover:bg-gray-700/50"
            >
              {serverItem.productId ? (
                <span className="truncate text-gray-700 dark:text-gray-300">
                  {serverItem.productName}
                </span>
              ) : (
                <span className="truncate text-gray-400 dark:text-gray-500">
                  {t('itemMatchAction')}
                  {serverItem.barcode && <span className="font-mono"> · {serverItem.barcode}</span>}
                </span>
              )}
            </button>
          )}
        </div>
        {editable && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={t('itemRemove')}
            data-testid={`item-remove-${index}`}
            className="text-sm text-gray-400 hover:text-red-600 dark:hover:text-red-400"
          >
            ✕
          </button>
        )}
      </div>

      {/* Field grid — unit price and discount are advisory; total is authoritative. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className={labelClass}>
          <span>{t('itemQty')}</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.001"
            value={row.quantityStr}
            onChange={(e) => onChange({ quantityStr: e.target.value })}
            disabled={!editable}
            data-testid={`item-qty-${index}`}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>{moneyLabel(t('itemUnitPrice'))}</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={row.unitPriceStr}
            onChange={(e) => onChange({ unitPriceStr: e.target.value })}
            disabled={!editable}
            data-testid={`item-unit-${index}`}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>{moneyLabel(t('itemDiscount'))}</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={row.discountStr}
            onChange={(e) => onChange({ discountStr: e.target.value })}
            disabled={!editable}
            data-testid={`item-discount-${index}`}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>{moneyLabel(t('itemTotal'))}</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={row.totalStr}
            onChange={(e) => onChange({ totalStr: e.target.value })}
            disabled={!editable}
            data-testid={`item-total-${index}`}
            className={inputClass}
          />
        </label>
      </div>

      <label className={labelClass}>
        <span>{t('itemCategory')}</span>
        <select
          value={row.categoryId ?? ''}
          onChange={(e) => onChange({ categoryId: e.target.value || null })}
          disabled={!editable}
          data-testid={`item-category-${index}`}
          className={inputClass}
        >
          <option value="">{t('itemNoCategory')}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
