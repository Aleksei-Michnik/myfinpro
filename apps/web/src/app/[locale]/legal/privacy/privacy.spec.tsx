import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import PrivacyPage from './page';

// Use vi.hoisted so the mock is available when vi.mock is hoisted
const { mockT } = vi.hoisted(() => {
  const translations: Record<string, string> = {
    'privacy.title': 'Privacy Policy',
    'privacy.lastUpdated': 'Last updated: April 2026',
    'privacy.intro': 'Your privacy is important to us...',
    'privacy.infoCollect.title': '1. Information We Collect',
    'privacy.infoCollect.content': 'We collect information you provide...',
    'privacy.howWeUse.title': '2. How We Use Your Information',
    'privacy.howWeUse.content': 'We use your information...',
    'privacy.storage.title': '3. Data Storage & Security',
    'privacy.storage.content': 'Your data is stored on secured servers...',
    'privacy.thirdParty.title': '4. Third-Party Services',
    'privacy.thirdParty.content': 'MyFinPro integrates with Google OAuth...',
    'privacy.cookies.title': '5. Cookies & Local Storage',
    'privacy.cookies.content': 'We use local storage...',
    'privacy.retention.title': '6. Data Retention & Deletion',
    'privacy.retention.content': 'You may request account deletion...',
    'privacy.rights.title': '7. Your Rights',
    'privacy.rights.content': 'You have the right to access...',
    'privacy.children.title': "8. Children's Privacy",
    'privacy.children.content': 'MyFinPro is not intended for children...',
    'privacy.changes.title': '9. Changes to Privacy Policy',
    'privacy.changes.content': 'We may update this Privacy Policy...',
    'privacy.contact.title': '10. Contact Information',
    'privacy.contact.content': 'Contact us through support channels.',
    'privacy.seeTerms': 'See also our <link>Terms of Use</link>.',
    'privacy.termsLinkText': 'Terms of Use',
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

describe('PrivacyPage', () => {
  async function renderPage() {
    const jsx = await PrivacyPage();
    render(jsx);
  }

  it('renders the Privacy Policy title', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument();
  });

  it('renders the last updated date', async () => {
    await renderPage();
    expect(screen.getByText('Last updated: April 2026')).toBeInTheDocument();
  });

  it('renders all section headings', async () => {
    await renderPage();
    const expectedHeadings = [
      '1. Information We Collect',
      '2. How We Use Your Information',
      '3. Data Storage & Security',
      '4. Third-Party Services',
      '5. Cookies & Local Storage',
      '6. Data Retention & Deletion',
      '7. Your Rights',
      "8. Children's Privacy",
      '9. Changes to Privacy Policy',
      '10. Contact Information',
    ];
    for (const heading of expectedHeadings) {
      expect(screen.getByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
    }
  });

  it('renders a link to the Terms of Use page', async () => {
    await renderPage();
    const termsLink = screen.getByRole('link', { name: 'Terms of Use' });
    expect(termsLink).toBeInTheDocument();
    expect(termsLink).toHaveAttribute('href', '/legal/terms');
  });

  it('renders a Back to Home link', async () => {
    await renderPage();
    const homeLink = screen.getByRole('link', { name: 'Back to Home' });
    expect(homeLink).toBeInTheDocument();
    expect(homeLink).toHaveAttribute('href', '/');
  });
});
