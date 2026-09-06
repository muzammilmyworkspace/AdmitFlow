import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { searchPrograms } from "@/services/catalog-service";

// GET /api/v1/programs — public, cursor-paginated programme search.
//
// The catalog is public marketing surface (docs/44-seo-strategy.md), so this endpoint is
// unauthenticated. Nothing student-specific is returned here; assessment scores and
// paywalled zone placement live behind /api/v1/assessment.

export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const params = request.nextUrl.searchParams;
    const numeric = (key: string) => {
      const raw = params.get(key);
      const value = raw === null ? NaN : Number(raw);
      return Number.isFinite(value) ? value : undefined;
    };

    const result = await searchPrograms(
      {
        query: params.get("q") ?? undefined,
        countryIds: params.getAll("countryId").filter(Boolean),
        level: params.get("level") ?? undefined,
        fieldOfStudy: params.get("field") ?? undefined,
        deliveryMode: params.get("mode") ?? undefined,
        maxTuition: numeric("maxTuition"),
        currency: params.get("currency") ?? undefined,
        intakeStatus: params.get("intakeStatus") ?? undefined,
        maxIeltsRequired: numeric("maxIelts"),
      },
      {
        cursor: params.get("cursor") ?? undefined,
        pageSize: numeric("pageSize"),
      },
    );

    return ok(
      { programs: result.items },
      {
        requestId,
        pagination: {
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
          pageSize: result.pageSize,
        },
      },
    );
  } catch (error) {
    return fail(error, requestId);
  }
}
