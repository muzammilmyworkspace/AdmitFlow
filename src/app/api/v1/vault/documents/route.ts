import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/response";
import { parseBody, requestIdOf } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireVerifiedActor } from "@/lib/auth/guards";
import { initiateUpload, listDocuments } from "@/services/vault/vault-service";

// GET  /api/v1/vault/documents — the caller's own documents + requirement checklist
// POST /api/v1/vault/documents — authorizes an upload and returns a short-lived URL

const uploadSchema = z.object({
  type: z.enum([
    "PASSPORT",
    "TRANSCRIPT",
    "DEGREE_CERTIFICATE",
    "LANGUAGE_TEST_REPORT",
    "SOP",
    "CV",
    "RECOMMENDATION_LETTER",
    "FINANCIAL_STATEMENT",
    "OTHER",
  ]),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
});

export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireVerifiedActor();
    const result = await listDocuments(actor.userId);
    return ok(result, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireVerifiedActor();
    await enforceRateLimit("VAULT_UPLOAD_AUTH", actor.userId);
    const body = await parseBody(request, uploadSchema);
    const result = await initiateUpload({ userId: actor.userId, ...body });
    return ok(result, { requestId }, { status: 201 });
  } catch (error) {
    return fail(error, requestId);
  }
}
