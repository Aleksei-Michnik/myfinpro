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

/** Shared focus ring for keyboard navigation visibility. */
const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600';

interface HeaderProps {
  /** Mobile drawer state, mirrored on the hamburger's aria-expanded. */
  isSidebarOpen?: boolean;
  /** Present only when the sidebar is available (authenticated). */
  onSidebarToggle?: () => void;
}

/**
 * Top bar of the app shell: brand, locale switcher, and session controls.
 * Authenticated navigation lives in the Sidebar; when it is available a
 * hamburger button toggles the mobile drawer. Signed-out visitors get the
 * public navigation links here.
 */
export function Header({ isSidebarOpen = false, onSidebarToggle }: HeaderProps) {
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
    <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/80 backdrop-blur-sm dark:border-gray-700 dark:bg-gray-900/95">
      <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          {onSidebarToggle && (
            <button
              type="button"
              onClick={onSidebarToggle}
              aria-expanded={isSidebarOpen}
              aria-controls="app-sidebar"
              aria-label={isSidebarOpen ? t('nav.closeMenu') : t('nav.menu')}
              data-testid="sidebar-toggle"
              className={`rounded-md p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900 md:hidden dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white ${focusRing}`}
            >
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                aria-hidden="true"
              >
                {isSidebarOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                  />
                )}
              </svg>
            </button>
          )}

          {/* App name */}
          <Link href="/" className={`rounded text-xl font-bold text-primary-600 ${focusRing}`}>
            {t('common.appName')}
          </Link>
        </div>

        <div className="flex items-center gap-3 md:gap-4">
          {!isLoading && !isAuthenticated && (
            <nav aria-label={t('nav.menu')} className="flex items-center gap-4 md:gap-6">
              <Link
                href="/"
                className={`hidden rounded text-sm text-gray-600 transition-colors hover:text-primary-600 md:inline dark:text-gray-300 dark:hover:text-primary-400 ${focusRing}`}
              >
                {t('nav.home')}
              </Link>
              <Link
                href="/help"
                className={`hidden rounded text-sm text-gray-600 transition-colors hover:text-primary-600 md:inline dark:text-gray-300 dark:hover:text-primary-400 ${focusRing}`}
              >
                {t('nav.help')}
              </Link>
              <Link
                href="/auth/login"
                className={`rounded text-sm text-gray-600 transition-colors hover:text-primary-600 dark:text-gray-300 dark:hover:text-primary-400 ${focusRing}`}
              >
                {t('nav.signIn')}
              </Link>
              <Link
                href="/auth/register"
                className={`rounded text-sm text-gray-600 transition-colors hover:text-primary-600 dark:text-gray-300 dark:hover:text-primary-400 ${focusRing}`}
              >
                {t('nav.signUp')}
              </Link>
            </nav>
          )}

          {!isLoading && isAuthenticated && (
            <>
              <span
                className="hidden text-sm font-medium text-gray-700 md:inline dark:text-gray-200"
                data-testid="user-name"
              >
                {user?.name}
              </span>
              <button
                onClick={handleLogout}
                className={`rounded text-sm text-gray-600 transition-colors hover:text-red-600 dark:text-gray-300 dark:hover:text-red-400 ${focusRing}`}
                type="button"
              >
                {t('nav.logout')}
              </button>
            </>
          )}

          {/* Locale switcher — scalable dropdown */}
          <select
            value={locale}
            onChange={(e) => handleLocaleSwitch(e.target.value)}
            className={`rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white ${focusRing}`}
            aria-label="Select language"
          >
            {locales.map((loc) => (
              <option key={loc} value={loc}>
                {localeNames[loc]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </header>
  );
}
