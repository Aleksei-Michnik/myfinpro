import type { ReactNode } from 'react';

export default function LegalLayout({ children }: { children: ReactNode }) {
  return <div className="container mx-auto px-4 py-8 max-w-4xl">{children}</div>;
}
