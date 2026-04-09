import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export default async function TermsPage() {
  const t = await getTranslations('legal');

  return (
    <article className="max-w-3xl mx-auto space-y-8 leading-relaxed text-gray-800 dark:text-gray-200">
      <header>
        <h1 className="text-3xl font-bold mb-2 text-gray-900 dark:text-white">
          {t('terms.title')}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('terms.lastUpdated')}</p>
      </header>

      <p>{t('terms.intro')}</p>

      <section>
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
          {t('terms.acceptance.title')}
        </h2>
        <p>{t('terms.acceptance.content')}</p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
          {t('terms.description.title')}
        </h2>
        <p>{t('terms.description.content')}</p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
          {t('terms.registration.title')}
        </h2>
        <p>{t('terms.registration.content')}</p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
          {t('terms.responsibilities.title')}
        </h2>
        <p>{t('terms.responsibilities.content')}</p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
          {t('terms.ownership.title')}
        </h2>
        <p>{t('terms.ownership.content')}</p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
          {t('terms.liability.title')}
        </h2>
        <p>{t('terms.liability.content')}</p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
          {t('terms.modifications.title')}
        </h2>
        <p>{t('terms.modifications.content')}</p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
          {t('terms.contact.title')}
        </h2>
        <p>{t('terms.contact.content')}</p>
      </section>

      <hr className="border-gray-300 dark:border-gray-600" />

      <p>
        {t.rich('terms.seePrivacy', {
          link: (chunks) => (
            <Link
              href="/legal/privacy"
              className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 underline"
            >
              {chunks}
            </Link>
          ),
        })}
      </p>

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
