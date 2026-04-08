import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

// Use vi.hoisted so the mock is available when vi.mock is hoisted
const { mockT } = vi.hoisted(() => {
  const translations: Record<string, string> = {
    'terms.title': 'Terms of Use',
    'terms.lastUpdated': 'Last updated: April 2026',
    'terms.intro': 'Welcome to MyFinPro...',
    'terms.acceptance.title': '1. Acceptance of Terms',
    'terms.acceptance.content': 'By creating an account...',
    'terms.description.title': '2. Description of Service',
    'terms.description.content': 'MyFinPro is a personal finance app...',
    'terms.registration.title': '3. Account Registration & Security',
    'terms.registration.content': 'You may register using email...',
    'terms.responsibilities.title': '4. User Responsibilities',
    'terms.responsibilities.content': 'You agree to provide accurate info...',
    'terms.ownership.title': '5. Data & Content Ownership',
    'terms.ownership.content': 'You retain ownership...',
    'terms.liability.title': '6. Limitation of Liability',
    'terms.liability.content': 'MyFinPro is provided as is...',
    'terms.modifications.title': '7. Modifications to Terms',
    'terms.modifications.content': 'We reserve the right to modify...',
    'terms.contact.title': '8. Contact Information',
    'terms.contact.content': 'Contact us through support channels.',
    'terms.seePrivacy': 'See also our <link>Privacy Policy</link>.',
    'terms.privacyLinkText': 'Privacy Policy',
    backToHome: 'Back to Home',
  };

  const t = Object.assign((key: string) => translations[key] || key, {
    rich: (key: string, options: Record<string, (chunks: React.ReactNode) => React.ReactNode>) => {
      const template = translations[key] || key;
      const match = template.match(/<link>(.*?)<\/link>/);
      if (match && options.link) {
        const before = template.slice(0, match.index);
        const after = template.slice((match.index || 0) + match[0].length);
        return React.createElement(React.Fragment, null, before, options.link(match[1]), after);
      }
      return template;
    },
  });

  return { mockT: t };
});

// Mock next-intl/server
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockResolvedValue(mockT),
}));

// Mock @/i18n/navigation
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Record<string, unknown>) =>
    React.createElement('a', { href, ...props }, children as React.ReactNode),
}));

import TermsPage from './page';

describe('TermsPage', () => {
  async function renderPage() {
    const jsx = await TermsPage();
    render(jsx);
  }

  it('renders the Terms of Use title', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Use' })).toBeInTheDocument();
  });

  it('renders the last updated date', async () => {
    await renderPage();
    expect(screen.getByText('Last updated: April 2026')).toBeInTheDocument();
  });

  it('renders all section headings', async () => {
    await renderPage();
    const expectedHeadings = [
      '1. Acceptance of Terms',
      '2. Description of Service',
      '3. Account Registration & Security',
      '4. User Responsibilities',
      '5. Data & Content Ownership',
      '6. Limitation of Liability',
      '7. Modifications to Terms',
      '8. Contact Information',
    ];
    for (const heading of expectedHeadings) {
      expect(screen.getByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
    }
  });

  it('renders a link to the Privacy Policy page', async () => {
    await renderPage();
    const privacyLink = screen.getByRole('link', { name: 'Privacy Policy' });
    expect(privacyLink).toBeInTheDocument();
    expect(privacyLink).toHaveAttribute('href', '/legal/privacy');
  });

  it('renders a Back to Home link', async () => {
    await renderPage();
    const homeLink = screen.getByRole('link', { name: 'Back to Home' });
    expect(homeLink).toBeInTheDocument();
    expect(homeLink).toHaveAttribute('href', '/');
  });
});
