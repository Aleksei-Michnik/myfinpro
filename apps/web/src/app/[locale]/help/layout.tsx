import type { ReactNode } from 'react';

export default function HelpLayout({ children }: { children: ReactNode }) {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl bg-white dark:bg-gray-900 min-h-screen">
      {children}
    </div>
  );
}
