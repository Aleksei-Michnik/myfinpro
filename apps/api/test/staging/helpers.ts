/**
 * Helper utilities for staging integration tests.
 */

export function getStagingApiUrl(): string {
  const url = (globalThis as unknown as Record<string, string>).__STAGING_API_URL__;
  if (!url) {
    throw new Error(
      'STAGING_API_URL is not set. Provide it via the STAGING_API_URL environment variable.',
    );
  }
  return url;
}

/**
 * Make an HTTP request to the staging API.
 */
export async function stagingFetch(path: string, options?: RequestInit): Promise<Response> {
  const baseUrl = getStagingApiUrl();
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
}

/**
 * Make a request and parse JSON response.
 */
export async function stagingFetchJson<T = Record<string, unknown>>(
  path: string,
  options?: RequestInit,
): Promise<{ status: number; body: T }> {
  const response = await stagingFetch(path, options);
  const body = (await response.json()) as T;
  return { status: response.status, body };
}
