import { useTranslations } from 'next-intl';

export default function HomePage() {
  const t = useTranslations();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold text-primary-600">{t('common.appName')}</h1>
      <p className="mt-4 text-lg text-gray-600">{t('home.title')}</p>
      <p className="mt-2 text-sm text-gray-400">{t('home.welcome')}</p>
    </main>
  );
}
