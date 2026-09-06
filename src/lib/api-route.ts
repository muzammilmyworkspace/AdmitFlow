import type { NextRequest } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";

// Shared route-handler helpers — docs/11-api-architecture.md (requestId propagation),
// docs/30-validation-rules.md (every input validated server-side with a schema;
// frontend validation is UX-only and never trusted).

export function requestIdOf(request: NextRequest): string {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
}

export function requestMeta(request: NextRequest) {
  return {
    userAgent: request.headers.get("user-agent"),
    ipAddress:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip"),
  };
}

export async function parseBody<T extends z.ZodTypeAny>(
  request: NextRequest,
  schema: T,
): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first?.path.join(".");
    throw new AppError(
      "VALIDATION_ERROR",
      field ? `${field}: ${first?.message}` : (first?.message ?? "Invalid request."),
    );
  }
  return parsed.data;
}
