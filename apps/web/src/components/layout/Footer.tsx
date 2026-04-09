'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export function Footer() {
  const t = useTranslations('footer');
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <nav className="flex flex-wrap items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
          <Link href="/legal/terms" className="hover:text-gray-700 dark:hover:text-gray-200">
            {t('terms')}
          </Link>
          <span className="hidden sm:inline" aria-hidden="true">
            |
          </span>
          <Link href="/legal/privacy" className="hover:text-gray-700 dark:hover:text-gray-200">
            {t('privacy')}
          </Link>
          <span className="hidden sm:inline" aria-hidden="true">
            |
          </span>
          <Link href="/help" className="hover:text-gray-700 dark:hover:text-gray-200">
            {t('help')}
          </Link>
        </nav>
        <p className="text-sm text-gray-400 dark:text-gray-500">{t('copyright', { year })}</p>
      </div>
    </footer>
  );
}
