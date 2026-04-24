'use client';

import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { locales, type Locale } from '@/i18n/routing';
import { useAuth } from '@/lib/auth/auth-context';

/** Native name display for each locale (add new ones here when scaling) */
const localeNames: Record<Locale, string> = {
  en: 'English',
  he: 'עברית',
};

/**
 * Header component with app name, auth-aware navigation, and locale switcher.
 * Shows user name + logout when authenticated, sign in/up links when not.
 */
export function Header() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { user, isAuthenticated, isLoading, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
  };

  const handleLocaleSwitch = (newLocale: string) => {
    document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    router.refresh();
  };

  return (
    <header className="border-b border-gray-200 bg-white/80 backdrop-blur-sm dark:border-gray-700 dark:bg-gray-900/95">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* App name */}
        <Link href="/" className="text-xl font-bold text-primary-600">
          {t('common.appName')}
        </Link>

        {/* Navigation */}
        <nav className="flex items-center gap-4 md:gap-6">
          <Link
            href="/"
            className="hidden md:inline text-sm text-gray-600 hover:text-primary-600 transition-colors dark:text-gray-300 dark:hover:text-primary-400"
          >
            {t('nav.home')}
          </Link>
          <Link
            href="/help"
            className="hidden md:inline text-sm text-gray-600 hover:text-primary-600 transition-colors dark:text-gray-300 dark:hover:text-primary-400"
          >
            {t('nav.help')}
          </Link>

          {!isLoading && isAuthenticated && (
            <>
              <Link
                href="/dashboard"
                className="text-sm text-gray-600 hover:text-primary-600 transition-colors dark:text-gray-300 dark:hover:text-primary-400"
              >
                {t('nav.dashboard')}
              </Link>
              <Link
                href="/groups"
                className="text-sm text-gray-600 hover:text-primary-600 transition-colors dark:text-gray-300 dark:hover:text-primary-400"
              >
                {t('nav.groups')}
              </Link>
              <Link
                href="/settings/account"
                className="hidden md:inline text-sm text-gray-600 hover:text-primary-600 transition-colors dark:text-gray-300 dark:hover:text-primary-400"
              >
                {t('nav.settings')}
              </Link>
              <span
                className="hidden md:inline text-sm text-gray-700 font-medium dark:text-gray-200"
                data-testid="user-name"
              >
                {user?.name}
              </span>
              <button
                onClick={handleLogout}
                className="text-sm text-gray-600 hover:text-red-600 transition-colors dark:text-gray-300 dark:hover:text-red-400"
                type="button"
              >
                {t('nav.logout')}
              </button>
            </>
          )}

          {!isLoading && !isAuthenticated && (
            <>
              <Link
                href="/auth/login"
                className="text-sm text-gray-600 hover:text-primary-600 transition-colors dark:text-gray-300 dark:hover:text-primary-400"
              >
                {t('nav.signIn')}
              </Link>
              <Link
                href="/auth/register"
                className="text-sm text-gray-600 hover:text-primary-600 transition-colors dark:text-gray-300 dark:hover:text-primary-400"
              >
                {t('nav.signUp')}
              </Link>
            </>
          )}
        </nav>

        {/* Locale switcher — scalable dropdown */}
        <select
          value={locale}
          onChange={(e) => handleLocaleSwitch(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-sm bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          aria-label="Select language"
        >
          {locales.map((loc) => (
            <option key={loc} value={loc}>
              {localeNames[loc]}
            </option>
          ))}
        </select>
      </div>
    </header>
  );
}
