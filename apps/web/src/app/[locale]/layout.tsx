import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';
import { TimezoneDetector } from '@/components/auth/TimezoneDetector';
import { VerificationBanner } from '@/components/auth/VerificationBanner';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { ToastProvider, ToastContainer } from '@/components/ui/Toast';
import { routing } from '@/i18n/routing';
import { AuthProvider } from '@/lib/auth/auth-context';
import { GroupProvider } from '@/lib/group/group-context';

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
          <AuthProvider>
            <GroupProvider>
              <ToastProvider>
                <Header />
                <VerificationBanner />
                <TimezoneDetector />
                <ErrorBoundary>{children}</ErrorBoundary>
                <Footer />
                <ToastContainer />
              </ToastProvider>
            </GroupProvider>
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
