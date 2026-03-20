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

/**
 * Retry a fetch until it returns the expected status code.
 * Useful for health checks that may return 503 during deploy transitions.
 */
export async function stagingFetchWithRetry(
  path: string,
  options?: RequestInit & { expectedStatus?: number; retries?: number; delayMs?: number },
): Promise<Response> {
  const { expectedStatus = 200, retries = 5, delayMs = 3000, ...fetchOptions } = options ?? {};
  let lastResponse: Response | undefined;

  for (let i = 0; i < retries; i++) {
    lastResponse = await stagingFetch(path, fetchOptions);
    if (lastResponse.status === expectedStatus) {
      return lastResponse;
    }
    if (i < retries - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // Return the last response even if it didn't match — let the test assertion handle it
  return lastResponse!;
}

/**
 * Retry a JSON fetch until it returns the expected status code.
 */
export async function stagingFetchJsonWithRetry<T = Record<string, unknown>>(
  path: string,
  options?: RequestInit & { expectedStatus?: number; retries?: number; delayMs?: number },
): Promise<{ status: number; body: T }> {
  const response = await stagingFetchWithRetry(path, options);
  const body = (await response.json()) as T;
  return { status: response.status, body };
}
