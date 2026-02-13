import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  // All supported locales
  locales: ['en', 'he'],

  // Default locale when no locale prefix is present
  defaultLocale: 'en',
});
