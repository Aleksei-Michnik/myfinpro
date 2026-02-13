import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';

import { Header } from '@/components/layout/Header';
import { routing } from '@/i18n/routing';

import '../globals.css';

export const metadata: Metadata = {
  title: 'MyFinPro - Finance Management',
  description: 'Personal and Family Finance Management Application',
};

/** RTL locales */
const RTL_LOCALES = ['he'];

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  // Ensure that the incoming `locale` is valid
  if (!routing.locales.includes(locale as 'en' | 'he')) {
    notFound();
  }

  // Provide all messages to the client
  const messages = await getMessages();

  const dir = RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir}>
      <body>
        <NextIntlClientProvider messages={messages}>
          <Header />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
