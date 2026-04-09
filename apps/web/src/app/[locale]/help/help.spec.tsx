import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

// Use vi.hoisted so the mock is available when vi.mock is hoisted
const { mockT } = vi.hoisted(() => {
  const translations: Record<string, string> = {
    title: 'How to Use MyFinPro',
    subtitle: 'A step-by-step guide to getting the most out of your personal finance manager.',
    backToHome: 'Back to Home',
    'gettingStarted.title': '1. Getting Started',
    'gettingStarted.createAccount.title': 'Creating an Account',
    'gettingStarted.createAccount.content':
      'You can sign up for MyFinPro using one of three methods...',
    'gettingStarted.verifyEmail.title': 'Verifying Your Email',
    'gettingStarted.verifyEmail.content':
      'After registering with email, you will receive a verification email...',
    'gettingStarted.loggingIn.title': 'Logging In',
    'gettingStarted.loggingIn.content': 'Go to the sign-in page and enter your credentials...',
    'managingAccount.title': '2. Managing Your Account',
    'managingAccount.settings.title': 'Account Settings',
    'managingAccount.settings.content':
      'From the Account Settings page you can view your profile...',
    'managingAccount.socialAccounts.title': 'Connecting Social Accounts',
    'managingAccount.socialAccounts.content':
      'You can connect Google and Telegram to your account...',
    'managingAccount.deleteAccount.title': 'Deleting Your Account',
    'managingAccount.deleteAccount.content': 'If you wish to delete your account...',
    'dashboard.title': '3. Using the Dashboard',
    'dashboard.overview.title': 'Dashboard Overview',
    'dashboard.overview.content':
      'The dashboard is your central hub for viewing your financial data...',
    'settingsPreferences.title': '4. Settings & Preferences',
    'settingsPreferences.currency.title': 'Changing Default Currency',
    'settingsPreferences.currency.content':
      'Go to Account Settings and find the Preferences section...',
    'settingsPreferences.timezone.title': 'Changing Timezone',
    'settingsPreferences.timezone.content': 'In the Preferences section of Account Settings...',
    'settingsPreferences.language.title': 'Changing Language',
    'settingsPreferences.language.content': 'Use the language switcher in the top-right corner...',
    'security.title': '5. Security Tips',
    'security.strongPassword.title': 'Strong Password Recommendations',
    'security.strongPassword.content': 'Use a password that is at least 8 characters long...',
    'security.keepSecure.title': 'Keeping Your Account Secure',
    'security.keepSecure.content': 'Never share your password with anyone...',
    'security.forgotPassword.title': 'Forgot Your Password?',
    'security.forgotPassword.content':
      'Go to the <link>forgot password page</link> to request a password reset link.',
    'gettingHelp.title': '6. Getting Help',
    'gettingHelp.contact.title': 'Contact & Support',
    'gettingHelp.contact.content': 'If you need assistance or have questions...',
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

import HelpPage from './page';

describe('HelpPage', () => {
  async function renderPage() {
    const jsx = await HelpPage();
    render(jsx);
  }

  it('renders the main title', async () => {
    await renderPage();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'How to Use MyFinPro',
      }),
    ).toBeInTheDocument();
  });

  it('renders the subtitle', async () => {
    await renderPage();
    expect(
      screen.getByText(
        'A step-by-step guide to getting the most out of your personal finance manager.',
      ),
    ).toBeInTheDocument();
  });

  it('renders all section headings', async () => {
    await renderPage();
    const expectedHeadings = [
      '1. Getting Started',
      '2. Managing Your Account',
      '3. Using the Dashboard',
      '4. Settings & Preferences',
      '5. Security Tips',
      '6. Getting Help',
    ];
    for (const heading of expectedHeadings) {
      expect(screen.getByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
    }
  });

  it('renders subsection headings', async () => {
    await renderPage();
    const expectedSubheadings = [
      'Creating an Account',
      'Verifying Your Email',
      'Logging In',
      'Account Settings',
      'Connecting Social Accounts',
      'Deleting Your Account',
      'Dashboard Overview',
      'Changing Default Currency',
      'Changing Timezone',
      'Changing Language',
      'Strong Password Recommendations',
      'Keeping Your Account Secure',
      'Forgot Your Password?',
      'Contact & Support',
    ];
    for (const heading of expectedSubheadings) {
      expect(screen.getByRole('heading', { level: 3, name: heading })).toBeInTheDocument();
    }
  });

  it('renders forgot password link', async () => {
    await renderPage();
    const forgotLink = screen.getByRole('link', {
      name: 'forgot password page',
    });
    expect(forgotLink).toBeInTheDocument();
    expect(forgotLink).toHaveAttribute('href', '/auth/forgot-password');
  });

  it('renders a Back to Home link', async () => {
    await renderPage();
    const homeLink = screen.getByRole('link', {
      name: 'Back to Home',
    });
    expect(homeLink).toBeInTheDocument();
    expect(homeLink).toHaveAttribute('href', '/');
  });

  it('renders without crashing', async () => {
    await renderPage();
    expect(screen.getByRole('article')).toBeInTheDocument();
  });
});
