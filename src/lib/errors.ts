// Standardized error taxonomy — docs/29-error-handling.md.
// Every response carries a requestId; stack traces/internal details are never exposed to clients.

export const ErrorCode = {
  AUTH_REQUIRED: "AUTH_REQUIRED",
  AUTH_INVALID_CREDENTIALS: "AUTH_INVALID_CREDENTIALS",
  AUTH_EMAIL_NOT_VERIFIED: "AUTH_EMAIL_NOT_VERIFIED",
  FORBIDDEN: "FORBIDDEN",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  PAYMENT_REQUIRED: "PAYMENT_REQUIRED",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  WEBHOOK_INVALID: "WEBHOOK_INVALID",
  WEBHOOK_DUPLICATE: "WEBHOOK_DUPLICATE",
  FILE_INVALID: "FILE_INVALID",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  DOCUMENT_ACCESS_DENIED: "DOCUMENT_ACCESS_DENIED",
  BOOKING_SLOT_TAKEN: "BOOKING_SLOT_TAKEN",
  APPLICATION_INVALID_STATE: "APPLICATION_INVALID_STATE",
  ASSESSMENT_NOT_READY: "ASSESSMENT_NOT_READY",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

const STATUS_BY_CODE: Record<ErrorCodeType, number> = {
  AUTH_REQUIRED: 401,
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_EMAIL_NOT_VERIFIED: 403,
  FORBIDDEN: 403,
  VALIDATION_ERROR: 400,
  RESOURCE_NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYMENT_REQUIRED: 402,
  PAYMENT_FAILED: 402,
  WEBHOOK_INVALID: 400,
  WEBHOOK_DUPLICATE: 200, // duplicate webhook is a no-op success, not an error, per docs/48-idempotency.md
  FILE_INVALID: 400,
  FILE_TOO_LARGE: 413,
  DOCUMENT_ACCESS_DENIED: 403,
  BOOKING_SLOT_TAKEN: 409,
  APPLICATION_INVALID_STATE: 409,
  ASSESSMENT_NOT_READY: 409,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCodeType;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCodeType, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export function statusForCode(code: ErrorCodeType): number {
  return STATUS_BY_CODE[code];
}
