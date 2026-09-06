import { describe, expect, it } from "vitest";
import { AppError, statusForCode } from "./errors";

describe("AppError", () => {
  it("maps error codes to the documented HTTP status (docs/29-error-handling.md)", () => {
    expect(statusForCode("AUTH_REQUIRED")).toBe(401);
    expect(statusForCode("FORBIDDEN")).toBe(403);
    expect(statusForCode("VALIDATION_ERROR")).toBe(400);
    expect(statusForCode("RESOURCE_NOT_FOUND")).toBe(404);
    expect(statusForCode("CONFLICT")).toBe(409);
    expect(statusForCode("RATE_LIMITED")).toBe(429);
    expect(statusForCode("PAYMENT_REQUIRED")).toBe(402);
    expect(statusForCode("FILE_TOO_LARGE")).toBe(413);
    expect(statusForCode("INTERNAL_ERROR")).toBe(500);
  });

  it("carries the code and status on the instance", () => {
    const err = new AppError("DOCUMENT_ACCESS_DENIED", "nope");
    expect(err.code).toBe("DOCUMENT_ACCESS_DENIED");
    expect(err.status).toBe(403);
    expect(err.message).toBe("nope");
  });
});
