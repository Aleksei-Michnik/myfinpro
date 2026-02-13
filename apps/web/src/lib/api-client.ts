/**
 * Typed API client for communicating with the NestJS backend.
 * Uses NEXT_PUBLIC_API_URL for client-side requests
 * and API_INTERNAL_URL for SSR requests.
 */

const getBaseUrl = (): string => {
  // Server-side: use internal URL
  if (typeof window === 'undefined') {
    return process.env.API_INTERNAL_URL || 'http://localhost:3001/api/v1';
  }
  // Client-side: use public URL
  return process.env.NEXT_PUBLIC_API_URL || '/api/v1';
};

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

class ApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = getBaseUrl();
  }

  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { body, headers, ...rest } = options;

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      ...rest,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error((errorBody as { message?: string }).message || `HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  async get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  async post<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'POST', body });
  }

  async put<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'PUT', body });
  }

  async patch<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'PATCH', body });
  }

  async delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
