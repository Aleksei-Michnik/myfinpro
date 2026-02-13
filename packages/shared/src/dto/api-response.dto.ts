/**
 * Standard API response wrapper DTOs.
 */

/** Standard successful API response envelope */
export interface ApiResponseDto<T> {
  /** Response payload */
  data: T;
  /** Optional human-readable message */
  message?: string;
  /** ISO 8601 timestamp of when the response was generated */
  timestamp: string;
}

/**
 * Helper to create a standard API response object.
 * Intended for use on the API side.
 */
export function createApiResponse<T>(data: T, message?: string): ApiResponseDto<T> {
  return {
    data,
    timestamp: new Date().toISOString(),
    ...(message !== undefined ? { message } : {}),
  };
}
