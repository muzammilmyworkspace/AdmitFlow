import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { getStorage, verifyLocalSignature } from "@/lib/storage";

// The local storage driver's object endpoint — development only.
//
// This is the stand-in for S3's presigned URL endpoint, and it enforces the same rule
// S3 does: the URL itself must carry a valid, unexpired signature over exactly this
// object key. There is no session check here by design — that's the point of a signed
// URL, and it mirrors production behaviour so the vault flow is genuinely exercised.
// Authorization to *obtain* one of these URLs happens in the vault service.

function assertLocalDriver() {
  if (getEnv().APP_ENV === "production" || getStorage().name !== "local") {
    throw new AppError("RESOURCE_NOT_FOUND", "Not found.");
  }
}

function parseParams(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const key = params.get("key");
  const expires = Number(params.get("expires"));
  const sig = params.get("sig");
  if (!key || !sig || !Number.isFinite(expires)) {
    throw new AppError("FILE_INVALID", "Malformed object URL.");
  }
  return { key, expires, sig };
}

export async function PUT(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    assertLocalDriver();
    const { key, expires, sig } = parseParams(request);
    if (!verifyLocalSignature(key, expires, "put", sig)) {
      throw new AppError("DOCUMENT_ACCESS_DENIED", "This upload link is invalid or has expired.");
    }
    const body = Buffer.from(await request.arrayBuffer());
    await getStorage().putObject(
      key,
      body,
      request.headers.get("content-type") ?? "application/octet-stream",
    );
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return fail(error, requestId);
  }
}

export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    assertLocalDriver();
    const { key, expires, sig } = parseParams(request);
    if (!verifyLocalSignature(key, expires, "get", sig)) {
      throw new AppError("DOCUMENT_ACCESS_DENIED", "This link is invalid or has expired.");
    }
    const body = await getStorage().getObject(key);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/octet-stream",
        // Never rendered inline: a stored file must not execute in the app's origin.
        "Content-Disposition": "attachment",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return fail(error, requestId);
  }
}
