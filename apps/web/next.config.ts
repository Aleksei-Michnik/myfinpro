import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Transpile workspace packages
  transpilePackages: ['@myfinpro/shared'],

  // Standalone output for Docker deployments
  output: 'standalone',

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
