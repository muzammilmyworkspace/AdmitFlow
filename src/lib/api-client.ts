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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload: ApiSuccess<T> | ApiFailure;
  try {
    payload = (await response.json()) as ApiSuccess<T> | ApiFailure;
  } catch {
    // A non-JSON response means something upstream failed before the app's error
    // envelope was applied — surface it as an app error rather than a parse crash.
    throw new ApiError({
      code: "INTERNAL_ERROR",
      message: `Unexpected server response (${response.status}).`,
      requestId: response.headers.get("x-request-id") ?? "unknown",
    });
  }

  if (!payload.success) throw new ApiError(payload.error);
  return payload.data;
}

export const apiGet = <T>(path: string) => request<T>("GET", path);
export const apiPost = <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
export const apiPatch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);
export const apiDelete = <T>(path: string) => request<T>("DELETE", path);
