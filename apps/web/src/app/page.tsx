import { redirect } from 'next/navigation';

import { routing } from '@/i18n/routing';

/**
 * Root page — redirects to the default locale.
 * The middleware should handle this, but this serves as a fallback.
 */
export default function RootPage() {
  redirect(`/${routing.defaultLocale}`);
}
