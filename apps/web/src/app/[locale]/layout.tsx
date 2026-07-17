import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';
import { TimezoneDetector } from '@/components/auth/TimezoneDetector';
import { VerificationBanner } from '@/components/auth/VerificationBanner';
import { AppShell } from '@/components/layout/AppShell';
import { Footer } from '@/components/layout/Footer';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { PageProgressBar } from '@/components/ui/PageProgressBar';
import { ToastProvider, ToastContainer } from '@/components/ui/Toast';
import { routing } from '@/i18n/routing';
import { AuthProvider } from '@/lib/auth/auth-context';
import { BudgetProvider } from '@/lib/budget/budget-context';
import { CategoryProvider } from '@/lib/category/category-context';
import { GroupProvider } from '@/lib/group/group-context';
import { ProductProvider } from '@/lib/product/product-context';
import { AuthenticatedRealtimeProvider } from '@/lib/realtime/AuthenticatedRealtimeProvider';
import { ReceiptProvider } from '@/lib/receipt/receipt-context';
import { TransactionProvider } from '@/lib/transaction/transaction-context';
import { UIStatusProvider } from '@/lib/ui';

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
          <UIStatusProvider>
            <PageProgressBar />
            <AuthProvider>
              <AuthenticatedRealtimeProvider>
                <GroupProvider>
                  <TransactionProvider>
                    <ReceiptProvider>
                      <ProductProvider>
                        <CategoryProvider>
                          <BudgetProvider>
                            <ToastProvider>
                              <AppShell>
                                <VerificationBanner />
                                <TimezoneDetector />
                                <ErrorBoundary>{children}</ErrorBoundary>
                                <Footer />
                              </AppShell>
                              <ToastContainer />
                            </ToastProvider>
                          </BudgetProvider>
                        </CategoryProvider>
                      </ProductProvider>
                    </ReceiptProvider>
                  </TransactionProvider>
                </GroupProvider>
              </AuthenticatedRealtimeProvider>
            </AuthProvider>
          </UIStatusProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
