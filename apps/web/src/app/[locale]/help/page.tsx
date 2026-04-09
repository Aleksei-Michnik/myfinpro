import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export default async function HelpPage() {
  const t = await getTranslations('help');

  return (
    <article className="max-w-3xl mx-auto space-y-10 leading-relaxed text-gray-800 dark:text-gray-200">
      <header>
        <h1 className="text-3xl font-bold mb-2 text-gray-900 dark:text-white">{t('title')}</h1>
        <p className="text-gray-600 dark:text-gray-400">{t('subtitle')}</p>
      </header>

      {/* 1. Getting Started */}
      <section className="space-y-6">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
          {t('gettingStarted.title')}
        </h2>

        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-white">
              {t('gettingStarted.createAccount.title')}
            </h3>
            <p>{t('gettingStarted.createAccount.content')}</p>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-white">
              {t('gettingStarted.verifyEmail.title')}
            </h3>
            <p>{t('gettingStarted.verifyEmail.content')}</p>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-white">
              {t('gettingStarted.loggingIn.title')}
            </h3>
            <p>{t('gettingStarted.loggingIn.content')}</p>
          </div>
        </div>
      </section>

      {/* 2. Managing Your Account */}
      <section className="space-y-6">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
          {t('managingAccount.title')}
        </h2>

        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-white">
              {t('managingAccount.settings.title')}
            </h3>
            <p>{t('managingAccount.settings.content')}</p>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-white">
              {t('managingAccount.socialAccounts.title')}
            </h3>
            <p>{t('managingAccount.socialAccounts.content')}</p>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-white">
              {t('managingAccount.deleteAccount.title')}
            </h3>
            <p>{t('managingAccount.deleteAccount.content')}</p>
          </div>
        </div>
      </section>

      {/* 3. Using the Dashboard */}
      <section className="space-y-6">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
          {t('dashboard.title')}
        </h2>

        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-white">
              {t('dashboard.overview.title')}
            </h3>
            <p>{t('dashboard.overview.content')}</p>
          </div>
        </div>
      </section>

      {/* 4. Settings & Preferences */}
      <section className="space-y-6">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
          {t('settingsPreferences.title')}
        </h2>

        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-white">
              {t('settingsPreferences.currency.title')}
            </h3>
            <p>{t('settingsPreferences.currency.content')}</p>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-white">
              {t('settingsPreferences.timezone.title')}
            </h3>
            <p>{t('settingsPreferences.timezone.content')}</p>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-white">
              {t('settingsPreferences.language.title')}
            </h3>
            <p>{t('settingsPreferences.language.content')}</p>
          </div>
        </div>
      </section>

      {/* 5. Security Tips */}
      <section className="space-y-6">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
          {t('security.title')}
        </h2>

        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-white">
              {t('security.strongPassword.title')}
            </h3>
            <p>{t('security.strongPassword.content')}</p>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-white">
              {t('security.keepSecure.title')}
            </h3>
            <p>{t('security.keepSecure.content')}</p>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-white">
              {t('security.forgotPassword.title')}
            </h3>
            <p>
              {t.rich('security.forgotPassword.content', {
                link: (chunks) => (
                  <Link
                    href="/auth/forgot-password"
                    className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 underline"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </div>
        </div>
      </section>

      {/* 6. Getting Help */}
      <section className="space-y-6">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
          {t('gettingHelp.title')}
        </h2>

        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-white">
              {t('gettingHelp.contact.title')}
            </h3>
            <p>{t('gettingHelp.contact.content')}</p>
          </div>
        </div>
      </section>

      <hr className="border-gray-300 dark:border-gray-600" />

      <p>
        <Link
          href="/"
          className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 underline"
        >
          {t('backToHome')}
        </Link>
      </p>
    </article>
  );
}
