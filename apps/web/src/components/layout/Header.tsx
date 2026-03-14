'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { useAuth } from '@/lib/auth/auth-context';

/**
 * Header component with app name, auth-aware navigation, and locale switcher.
 * Shows user name + logout when authenticated, sign in/up links when not.
 */
export function Header() {
  const t = useTranslations();
  const currentLocale = useLocale();
  const { user, isAuthenticated, isLoading, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
  };

  return (
    <header className="border-b border-gray-200 bg-white/80 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* App name */}
        <Link href="/" className="text-xl font-bold text-primary-600">
          {t('common.appName')}
        </Link>

        {/* Navigation */}
        <nav className="hidden md:flex items-center gap-6">
          <Link href="/" className="text-sm text-gray-600 hover:text-primary-600 transition-colors">
            {t('nav.home')}
          </Link>

          {!isLoading && isAuthenticated && (
            <>
              <Link
                href="/dashboard"
                className="text-sm text-gray-600 hover:text-primary-600 transition-colors"
              >
                {t('nav.dashboard')}
              </Link>
              <span className="text-sm text-gray-700 font-medium" data-testid="user-name">
                {user?.name}
              </span>
              <button
                onClick={handleLogout}
                className="text-sm text-gray-600 hover:text-red-600 transition-colors"
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
                className="text-sm text-gray-600 hover:text-primary-600 transition-colors"
              >
                {t('nav.signIn')}
              </Link>
              <Link
                href="/auth/register"
                className="text-sm text-gray-600 hover:text-primary-600 transition-colors"
              >
                {t('nav.signUp')}
              </Link>
            </>
          )}
        </nav>

        {/* Locale switcher */}
        <div className="flex items-center gap-2">
          {routing.locales.map((locale) => (
            <Link
              key={locale}
              href="/"
              locale={locale}
              className={`rounded-md px-2 py-1 text-sm transition-colors ${
                currentLocale === locale
                  ? 'bg-primary-100 text-primary-700 font-medium'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {locale.toUpperCase()}
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}
