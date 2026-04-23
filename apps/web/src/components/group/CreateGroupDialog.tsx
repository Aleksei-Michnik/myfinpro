'use client';

import { CURRENCIES, CURRENCY_CODES, GROUP_TYPES } from '@myfinpro/shared';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { useGroups } from '@/lib/group/group-context';

interface CreateGroupDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_TYPE = 'family';
const DEFAULT_CURRENCY = 'USD';

export function CreateGroupDialog({ isOpen, onClose }: CreateGroupDialogProps) {
  const t = useTranslations('groups');
  const { createGroup } = useGroups();
  const { addToast } = useToast();

  const [name, setName] = useState('');
  const [type, setType] = useState<string>(DEFAULT_TYPE);
  const [defaultCurrency, setDefaultCurrency] = useState<string>(DEFAULT_CURRENCY);
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !isLoading;

  const reset = () => {
    setName('');
    setType(DEFAULT_TYPE);
    setDefaultCurrency(DEFAULT_CURRENCY);
    setIsLoading(false);
  };

  const handleClose = () => {
    if (isLoading) return;
    reset();
    onClose();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!trimmedName) return;

    setIsLoading(true);
    try {
      await createGroup({ name: trimmedName, type, defaultCurrency });
      addToast('success', t('create.success'));
      reset();
      onClose();
    } catch (err) {
      const message = (err as Error).message || t('create.error');
      addToast('error', message);
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      data-testid="create-group-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-group-title"
    >
      <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <h2
          id="create-group-title"
          className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          {t('create.title')}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Input
            name="group-name"
            type="text"
            label={t('create.name')}
            placeholder={t('create.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isLoading}
            autoComplete="off"
            required
            data-testid="group-name-input"
          />

          <div>
            <label
              htmlFor="group-type-select"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t('create.type')}
            </label>
            <select
              id="group-type-select"
              data-testid="group-type-select"
              value={type}
              onChange={(e) => setType(e.target.value)}
              disabled={isLoading}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              {GROUP_TYPES.map((groupType) => (
                <option key={groupType} value={groupType}>
                  {t(`type.${groupType}`)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="group-currency-select"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t('create.currency')}
            </label>
            <select
              id="group-currency-select"
              data-testid="group-currency-select"
              value={defaultCurrency}
              onChange={(e) => setDefaultCurrency(e.target.value)}
              disabled={isLoading}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              {CURRENCY_CODES.map((code) => (
                <option key={code} value={code}>
                  {CURRENCIES[code].symbol} {code} — {CURRENCIES[code].name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="flex-1"
              onClick={handleClose}
              disabled={isLoading}
              data-testid="cancel-create-group-btn"
            >
              {t('create.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              className="flex-1"
              disabled={!canSubmit}
              data-testid="confirm-create-group-btn"
            >
              {isLoading ? t('create.creating') : t('create.create')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
