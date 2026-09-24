import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { locales } from './src/i18n/routing';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Transpile workspace packages
  transpilePackages: ['@myfinpro/shared'],

  // Standalone output for Docker deployments
  output: 'standalone',

  // mdock (infra repo): the page is served at the production hostname while Next sees localhost,
  // and Next 16 answers 403 to /_next dev requests from an origin it does not know. Set only by
  // docker-compose.mdock.yml from the developer's local .env; empty everywhere else.
  allowedDevOrigins: process.env.MDOCK_DEV_ORIGINS ? process.env.MDOCK_DEV_ORIGINS.split(',') : [],

  // Allow Server Actions from reverse proxy origins (CloudFlare)
  experimental: {
    serverActions: {
      allowedOrigins: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [],
    },
  },

  // 301 redirects for old /{locale}/... URLs → /...
  async redirects() {
    return locales.flatMap((locale) => [
      {
        source: `/${locale}/:path+`,
        destination: '/:path+',
        permanent: true,
      },
      {
        source: `/${locale}`,
        destination: '/',
        permanent: true,
      },
    ]);
  },

  // Proxy API requests in development
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_INTERNAL_URL || 'http://localhost:3001/api/v1'}/:path*`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
