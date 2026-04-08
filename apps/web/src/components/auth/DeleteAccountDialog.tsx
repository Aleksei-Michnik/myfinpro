'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/lib/auth/auth-context';

interface DeleteAccountDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DeleteAccountDialog({ isOpen, onClose }: DeleteAccountDialogProps) {
  const t = useTranslations('settings.account');
  const { user, deleteAccount } = useAuth();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const emailMatches = email === user?.email;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!emailMatches) return;

    setIsLoading(true);
    setError('');

    try {
      await deleteAccount(email);
    } catch (err) {
      setError((err as Error).message || 'Failed to delete account');
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setEmail('');
    setError('');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      data-testid="delete-account-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
    >
      <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 id="delete-dialog-title" className="mb-4 text-lg font-semibold text-red-600">
          {t('deleteAccount')}
        </h2>

        <p className="mb-4 text-sm text-gray-600" data-testid="delete-warning">
          {t('deleteWarning')}
        </p>

        {error && (
          <div
            className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700"
            role="alert"
            data-testid="delete-error"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Input
            name="confirm-email"
            type="email"
            label={t('confirmEmail')}
            placeholder={user?.email}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
            autoComplete="off"
          />

          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="flex-1"
              onClick={handleClose}
              disabled={isLoading}
              data-testid="cancel-delete-btn"
            >
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              className="flex-1 !bg-red-600 hover:!bg-red-700 focus:!ring-red-500"
              disabled={!emailMatches || isLoading}
              data-testid="confirm-delete-btn"
            >
              {isLoading ? '...' : t('deleteButton')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
