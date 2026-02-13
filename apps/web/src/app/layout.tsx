import type { ReactNode } from 'react';

/**
 * Root layout — serves as a pass-through wrapper.
 * The actual locale-aware layout lives in [locale]/layout.tsx.
 * next-intl middleware handles redirecting to the correct locale.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
