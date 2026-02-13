import { useTranslations } from 'next-intl';

export default function NotFoundPage() {
  const t = useTranslations('common');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-6xl font-bold text-gray-300">404</h1>
      <p className="mt-4 text-lg text-gray-600">
        Page not found
      </p>
      <a
        href="/"
        className="mt-6 rounded-md bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 transition-colors"
      >
        {t('back')}
      </a>
    </main>
  );
}
