import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export default async function PrivacyPage() {
  const t = await getTranslations('legal');

  return (
    <article className="max-w-3xl mx-auto space-y-8 leading-relaxed text-gray-800 dark:text-gray-200">
      <header>
        <h1 className="text-3xl font-bold mb-2 text-gray-900 dark:text-white">
          {t('privacy.title')}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('privacy.lastUpdated')}</p>
      </header>

      <p>{t('privacy.intro')}</p>

      <section>
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
          {t('privacy.infoCollect.title')}
        </h2>
        <p>{t('privacy.infoCollect.content')}</p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
          {t('privacy.howWeUse.title')}
        </h2>
        <p>{t('privacy.howWeUse.content')}</p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
          {t('privacy.storage.title')}
        </h2>
        <p>{t('privacy.storage.content')}</p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
          {t('privacy.thirdParty.title')}
        </h2>
        <p>{t('privacy.thirdParty.content')}</p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
          {t('privacy.cookies.title')}
        </h2>
        <p>{t('privacy.cookies.content')}</p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
          {t('privacy.retention.title')}
        </h2>
        <p>{t('privacy.retention.content')}</p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
          {t('privacy.rights.title')}
        </h2>
        <p>{t('privacy.rights.content')}</p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
          {t('privacy.children.title')}
        </h2>
        <p>{t('privacy.children.content')}</p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
          {t('privacy.changes.title')}
        </h2>
        <p>{t('privacy.changes.content')}</p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
          {t('privacy.contact.title')}
        </h2>
        <p>{t('privacy.contact.content')}</p>
      </section>

      <hr className="border-gray-300 dark:border-gray-600" />

      <p>
        {t.rich('privacy.seeTerms', {
          link: (chunks) => (
            <Link
              href="/legal/terms"
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
