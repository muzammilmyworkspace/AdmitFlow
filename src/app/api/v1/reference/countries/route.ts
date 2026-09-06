import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";

// GET /api/v1/reference/countries — public reference data used by the onboarding and
// search forms. No authentication: this is a static list of countries, not user data.

export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const countries = await db.country.findMany({
      orderBy: { name: "asc" },
      select: { id: true, isoCode2: true, name: true, region: true },
    });
    return ok({ countries }, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
