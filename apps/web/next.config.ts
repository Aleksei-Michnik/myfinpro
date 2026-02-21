import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Trust CloudFlare proxy headers for correct client IP detection
  // Using environment-based configuration for production deployments
  // Note: Using type assertion as trustProxy may not be in TypeScript types yet
} as NextConfig;

// Transpile workspace packages
nextConfig.transpilePackages = ['@myfinpro/shared'];

// Standalone output for Docker deployments
nextConfig.output = 'standalone';

// Trust proxy for CloudFlare in production
if (process.env.NODE_ENV === 'production') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (nextConfig as any).trustProxy = true;
}

// Proxy API requests in development
nextConfig.rewrites = async () => {
  return [
    {
      source: '/api/:path*',
      destination: `${process.env.API_INTERNAL_URL || 'http://localhost:3001/api/v1'}/:path*`,
    },
  ];
};

export default withNextIntl(nextConfig);
