'use client';

// Phase 8 — create/edit a global registry product (design §1.1/§1.4).
// Barcode can be typed or scanned; unknown barcodes are looked up against
// Open Food Facts and prefill empty name/brand fields (plus a background
// image fetch on create). The default category is restricted to SYSTEM
// expense categories — the only ones meaningful on a global product.

import { isValidGtin, normalizeGtin } from '@myfinpro/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BarcodeScannerDialog } from './BarcodeScannerDialog';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useProducts } from '@/lib/product/product-context';
import type { ProductSummary } from '@/lib/product/types';
import type { CategoryDto } from '@/lib/transaction/types';
import { useAsyncOperation } from '@/lib/ui';

const inputClass =
  'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 ' +
  'focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 ' +
  'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

export interface ProductFormDialogProps {
  open: boolean;
  /** Present = edit mode; absent = create mode. */
  product?: ProductSummary | null;
  /** Prefill for create mode (e.g. the walkthrough item's raw name). */
  initialName?: string;
  initialBarcode?: string;
  /** Visible OUT categories; only system ones are offered as default. */
  categories: CategoryDto[];
  onCancel(): void;
  onSaved(product: ProductSummary): void;
}

export function ProductFormDialog({
  open,
  product,
  initialName,
  initialBarcode,
  categories,
  onCancel,
  onSaved,
}: ProductFormDialogProps) {
  const t = useTranslations('products.form');
  const locale = useLocale();
  const { createProduct, updateProduct, lookupBarcode } = useProducts();
  const { addToast } = useToast();

  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [barcode, setBarcode] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [offHint, setOffHint] = useState<'checking' | 'filled' | 'exists' | null>(null);
  const [offImageUrl, setOffImageUrl] = useState<string | null>(null);
  const [existing, setExisting] = useState<ProductSummary | null>(null);

  const saveOp = useAsyncOperation<ProductSummary>({ scope: 'control' });
  const nameRef = useRef<HTMLInputElement | null>(null);
  const editing = !!product;

  const systemCategories = useMemo(
    () => categories.filter((c) => c.ownerType === 'system'),
    [categories],
  );

  useEffect(() => {
    if (!open) return;
    setName(product?.name ?? initialName ?? '');
    setBrand(product?.brand ?? '');
    setBarcode(product?.barcode ?? initialBarcode ?? '');
    setCategoryId(product?.defaultCategoryId ?? '');
    setOffHint(null);
    setOffImageUrl(null);
    setExisting(null);
    // A create opened with a code (scan / printed receipt code, 8.23)
    // resolves it immediately — brand/image prefill shouldn't wait for a
    // manual field blur.
    if (!product && initialBarcode) resolveBarcode(initialBarcode);
    // Focus the first field once mounted.
    setTimeout(() => nameRef.current?.focus(), 0);
  }, [open, product, initialName, initialBarcode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !scannerOpen) {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel, scannerOpen]);

  useEffect(() => {
    if (saveOp.error && saveOp.error.reason !== 'aborted') {
      addToast('error', saveOp.error.message || t('saveFailed'));
    }
  }, [saveOp.error, addToast, t]);

  /** Registry/OFF lookup on a complete barcode — prefills empty fields. */
  const resolveBarcode = (raw: string) => {
    const code = normalizeGtin(raw);
    if (!isValidGtin(code)) return;
    setOffHint('checking');
    setExisting(null);
    void lookupBarcode(code)
      .then((res) => {
        if (res.found && res.product && res.product.id !== product?.id) {
          setExisting(res.product);
          setOffHint('exists');
          return;
        }
        if (res.prefill) {
          setName((prev) => prev.trim() || res.prefill?.name || prev);
          setBrand((prev) => prev.trim() || res.prefill?.brand || prev);
          setOffImageUrl(res.prefill.imageUrl);
          setOffHint('filled');
          return;
        }
        setOffHint(null);
      })
      .catch(() => setOffHint(null));
  };

  const submit = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      addToast('error', t('nameRequired'));
      return;
    }
    const code = normalizeGtin(barcode);
    if (code && !isValidGtin(code)) {
      addToast('error', t('barcodeInvalid'));
      return;
    }
    void saveOp
      .run(async (signal) => {
        if (editing && product) {
          return updateProduct(
            product.id,
            {
              name: trimmedName,
              brand: brand.trim() || null,
              barcode: code || null,
              defaultCategoryId: categoryId || null,
            },
            signal,
          );
        }
        return createProduct(
          {
            name: trimmedName,
            brand: brand.trim() || undefined,
            barcode: code || undefined,
            defaultCategoryId: categoryId || undefined,
            aliasLocale: locale,
            imageUrl: offImageUrl ?? undefined,
          },
          signal,
        );
      })
      .then((saved) => {
        if (saved !== undefined) {
          addToast('success', editing ? t('updatedToast') : t('createdToast'));
          onSaved(saved);
        }
      });
  };

  if (!open || typeof document === 'undefined') return null;

  const node = (
    <div
      data-testid="product-form-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-form-title"
        data-testid="product-form-dialog"
        className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-800"
      >
        <h2
          id="product-form-title"
          className="text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          {editing ? t('editTitle') : t('createTitle')}
        </h2>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <label
              htmlFor="product-form-name"
              className="text-xs font-medium text-gray-500 dark:text-gray-400"
            >
              {t('nameLabel')}
            </label>
            <input
              id="product-form-name"
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={300}
              data-testid="product-form-name"
              className={inputClass}
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="product-form-brand"
              className="text-xs font-medium text-gray-500 dark:text-gray-400"
            >
              {t('brandLabel')}
            </label>
            <input
              id="product-form-brand"
              type="text"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              maxLength={200}
              data-testid="product-form-brand"
              className={inputClass}
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="product-form-barcode"
              className="text-xs font-medium text-gray-500 dark:text-gray-400"
            >
              {t('barcodeLabel')}
            </label>
            <div className="flex gap-2">
              <input
                id="product-form-barcode"
                type="text"
                inputMode="numeric"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onBlur={(e) => resolveBarcode(e.target.value)}
                placeholder="7290000000000"
                data-testid="product-form-barcode"
                className={inputClass}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setScannerOpen(true)}
                data-testid="product-form-scan"
              >
                {t('scan')}
              </Button>
            </div>
            <p role="status" aria-live="polite" className="min-h-4 text-xs">
              {offHint === 'checking' && (
                <span className="text-gray-500 dark:text-gray-400">{t('offChecking')}</span>
              )}
              {offHint === 'filled' && (
                <span
                  className="text-green-700 dark:text-green-400"
                  data-testid="product-form-off-filled"
                >
                  {t('offFilled')}
                </span>
              )}
              {offHint === 'exists' && existing && (
                <span
                  className="text-amber-700 dark:text-amber-400"
                  data-testid="product-form-exists"
                >
                  {t('barcodeExists', { name: existing.name })}
                </span>
              )}
            </p>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="product-form-category"
              className="text-xs font-medium text-gray-500 dark:text-gray-400"
            >
              {t('categoryLabel')}
            </label>
            <select
              id="product-form-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              data-testid="product-form-category"
              className={inputClass}
            >
              <option value="">{t('noCategory')}</option>
              {systemCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 dark:text-gray-500">{t('categoryHint')}</p>
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={onCancel}
              disabled={saveOp.isLoading}
              data-testid="product-form-cancel"
            >
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={saveOp.isLoading}
              data-testid="product-form-submit"
            >
              {editing ? t('save') : t('create')}
            </Button>
          </div>
        </form>
      </div>

      <BarcodeScannerDialog
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={(code) => {
          setBarcode(code);
          resolveBarcode(code);
        }}
      />
    </div>
  );

  return createPortal(node, document.body);
}
