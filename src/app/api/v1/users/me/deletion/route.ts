import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { requireActor } from "@/lib/auth/guards";
import {
  DELETION_DISCLOSURE,
  DELETION_GRACE_DAYS,
  cancelDeletion,
  getPendingDeletion,
  requestDeletion,
} from "@/services/account-service";

// GET    /api/v1/users/me/deletion — is one pending, and what will it do?
// POST   /api/v1/users/me/deletion — request it (starts the grace period).
// DELETE /api/v1/users/me/deletion — cancel it, during the grace period.
//
// The disclosure is served from the same constant the deletion itself uses, so what the
// student is shown before agreeing cannot drift from what actually happens.

export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireActor();
    const pending = await getPendingDeletion(actor.userId);
    return ok(
      { pending, disclosure: DELETION_DISCLOSURE, graceDays: DELETION_GRACE_DAYS },
      { requestId },
    );
  } catch (error) {
    return fail(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireActor();
    const result = await requestDeletion(actor.userId);
    return ok(result, { requestId }, { status: 201 });
  } catch (error) {
    return fail(error, requestId);
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireActor();
    await cancelDeletion(actor.userId);
    return ok({ cancelled: true }, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
