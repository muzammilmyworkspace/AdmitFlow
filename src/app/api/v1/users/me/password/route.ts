import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/response";
import { parseBody, requestIdOf } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireActor } from "@/lib/auth/guards";
import { currentSessionTokenHash } from "@/lib/auth/session";
import { changePassword } from "@/services/account-service";

// POST /api/v1/users/me/password — change your own password.
//
// Rate-limited on the same policy as a reset request: this endpoint takes the current
// password, so an unlimited one is an online guessing oracle against a live session.

const schema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: z.string().min(1, "Enter a new password."),
});

export async function POST(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireActor();
    await enforceRateLimit("PASSWORD_RESET_REQUEST", actor.userId);
    const body = await parseBody(request, schema);

    await changePassword({
      userId: actor.userId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      currentSessionTokenHash: await currentSessionTokenHash(),
      ipAddress: request.headers.get("x-forwarded-for"),
    });

    return ok({ changed: true }, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
