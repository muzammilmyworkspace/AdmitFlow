import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { AppError, ErrorCode, statusForCode } from "./errors";
import { logger } from "./logger";

// Consistent API response envelope — docs/11-api-architecture.md, docs/29-error-handling.md.

export interface ApiMeta {
  requestId: string;
  [key: string]: unknown;
}

export function ok<T>(data: T, meta: Partial<ApiMeta> = {}, init?: ResponseInit) {
  const requestId = (meta.requestId as string) ?? randomUUID();
  return NextResponse.json(
    { success: true as const, data, meta: { ...meta, requestId } },
    init,
  );
}

export function fail(error: unknown, requestId: string = randomUUID()) {
  if (error instanceof AppError) {
    if (error.status >= 500) {
      logger.error(error.message, { requestId, errorCode: error.code });
    }
    return NextResponse.json(
      {
        success: false as const,
        error: { code: error.code, message: error.message, requestId },
      },
      { status: error.status },
    );
  }

  // Unknown/unhandled error — never leak internals to the client.
  logger.error(error instanceof Error ? error.message : "Unknown error", {
    requestId,
    errorCode: ErrorCode.INTERNAL_ERROR,
    stack: error instanceof Error ? error.stack : undefined,
  });
  return NextResponse.json(
    {
      success: false as const,
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: "An unexpected error occurred. Please try again.",
        requestId,
      },
    },
    { status: statusForCode(ErrorCode.INTERNAL_ERROR) },
  );
}
