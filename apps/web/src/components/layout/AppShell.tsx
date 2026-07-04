'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { usePathname } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth/auth-context';

/**
 * Control-panel app shell: a persistent sidebar for authenticated users
 * (drawer on mobile), header on top of the content column, and a skip
 * link for keyboard/screen-reader users.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const { isAuthenticated, isLoading } = useAuth();
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Close the mobile drawer whenever navigation happens.
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [pathname]);

  const showSidebar = !isLoading && isAuthenticated;

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary-600 focus:px-4 focus:py-2 focus:text-white"
      >
        {t('nav.skipToContent')}
      </a>

      {showSidebar && <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          isSidebarOpen={isSidebarOpen}
          onSidebarToggle={showSidebar ? () => setIsSidebarOpen((open) => !open) : undefined}
        />
        {/* Not a <main> — pages own their main landmark; this is just the
            skip-link target wrapping the content column. */}
        <div id="main-content" className="flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}
