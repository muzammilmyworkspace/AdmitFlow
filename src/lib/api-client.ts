// Centralized API client — docs/07-frontend-architecture.md §5.
// Normalizes the success/error envelope so no component ever hand-parses a response,
// and surfaces the server's requestId for support/log correlation.

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: { requestId: string };
}

export interface ApiFailure {
  success: false;
  error: { code: string; message: string; requestId: string };
}

export class ApiError extends Error {
  readonly code: string;
  readonly requestId: string;

  constructor(failure: ApiFailure["error"]) {
    super(failure.message);
    this.name = "ApiError";
    this.code = failure.code;
    this.requestId = failure.requestId;
  }
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as ApiSuccess<T> | ApiFailure;
  if (!payload.success) throw new ApiError(payload.error);
  return payload.data;
}
