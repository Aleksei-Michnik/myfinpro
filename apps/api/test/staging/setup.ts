/**
 * Staging integration test setup.
 * Reads STAGING_API_URL from environment, falls back to default.
 */

const STAGING_API_URL = process.env.STAGING_API_URL;

// Make it available to all tests via a global
(globalThis as unknown as Record<string, string | undefined>).__STAGING_API_URL__ = STAGING_API_URL;

// Set a reasonable timeout for HTTP requests to staging
jest.setTimeout(30_000);

// Log the staging URL for debugging
console.log(`\n🎯 Running staging tests against: ${STAGING_API_URL}\n`);
