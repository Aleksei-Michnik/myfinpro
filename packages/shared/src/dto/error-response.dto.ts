/**
 * Error response DTOs for standardized API error handling.
 */

/** Standard API error response body */
export interface ApiErrorResponseDto {
  /** HTTP status code */
  statusCode: number;
  /** Human-readable error message */
  message: string;
  /** Machine-readable error code (e.g., 'VALIDATION_ERROR', 'NOT_FOUND') */
  error: string;
  /** ISO 8601 timestamp of when the error occurred */
  timestamp: string;
  /** Request path that triggered the error */
  path: string;
  /** Optional details (validation errors or additional context) */
  details?: ValidationErrorDetail[] | Record<string, unknown>;
}

/** Detail for a single field validation error */
export interface ValidationErrorDetail {
  /** Field name that failed validation */
  field: string;
  /** Human-readable validation error message */
  message: string;
  /** The invalid value (optional, omitted for security-sensitive fields) */
  value?: unknown;
}

/** Standard machine-readable error codes */
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  CONFLICT = 'CONFLICT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
  BAD_REQUEST = 'BAD_REQUEST',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}
