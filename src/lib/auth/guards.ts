import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getSessionUser } from "./session";
import { PERMISSIONS, type PermissionKey } from "@/lib/rbac";

// Authorization guards — docs/13-authentication-authorization.md §6/§7.
//
// Every protected route resolves the actor through these helpers rather than checking
// `role === "ADMIN"` inline: permissions are the unit of authorization, roles are just
// named bundles, which is what lets the seven future roles be added without touching
// call sites.

export interface Actor {
  userId: string;
  email: string;
  status: string;
  roles: string[];
  permissions: Set<PermissionKey>;
  profileId: string | null;
}

async function permissionsFor(roleIds: string[]): Promise<Set<PermissionKey>> {
  if (roleIds.length === 0) return new Set();
  const rows = await db.rolePermission.findMany({
    where: { roleId: { in: roleIds } },
    include: { permission: true },
  });
  return new Set(rows.map((r) => r.permission.key as PermissionKey));
}

/** Returns the current actor, or null when unauthenticated. Never throws. */
export async function getActor(): Promise<Actor | null> {
  const current = await getSessionUser();
  if (!current) return null;

  const { user } = current;
  return {
    userId: user.id,
    email: user.email,
    status: user.status,
    roles: user.userRoles.map((ur) => ur.role.name),
    permissions: await permissionsFor(user.userRoles.map((ur) => ur.roleId)),
    profileId: user.profile?.id ?? null,
  };
}

/** Requires any authenticated, non-suspended account. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new AppError("AUTH_REQUIRED", "You must be signed in.");
  if (actor.status === "SUSPENDED" || actor.status === "DEACTIVATED") {
    throw new AppError("ACCOUNT_SUSPENDED", "This account is not currently active.");
  }
  return actor;
}

/**
 * Requires an account that has finished email verification, i.e. anything past
 * EMAIL_UNVERIFIED. ONBOARDING is allowed because the onboarding wizard itself needs it.
 */
export async function requireVerifiedActor(): Promise<Actor> {
  const actor = await requireActor();
  if (actor.status === "REGISTERED" || actor.status === "EMAIL_UNVERIFIED") {
    throw new AppError("AUTH_EMAIL_NOT_VERIFIED", "Please verify your email address to continue.");
  }
  return actor;
}

/**
 * Requires a fully onboarded (ACTIVE) student. Gates the parts of the product that only
 * make sense with a complete profile — assessment, applications, bookings
 * (docs/31-state-machines.md §1, transition A5).
 */
export async function requireActiveActor(): Promise<Actor> {
  const actor = await requireVerifiedActor();
  if (actor.status === "ONBOARDING") {
    throw new AppError("FORBIDDEN", "Complete your profile to unlock this step.");
  }
  return actor;
}

/** Requires a specific permission. Used by every admin/staff endpoint. */
export async function requirePermissionActor(permission: PermissionKey): Promise<Actor> {
  const actor = await requireActor();
  if (!actor.permissions.has(permission)) {
    throw new AppError("FORBIDDEN", "You do not have permission to perform this action.");
  }
  return actor;
}

/** Convenience: any staff-level account (has at least one admin-only permission). */
export async function requireStaffActor(): Promise<Actor> {
  const actor = await requireActor();
  const isStaff =
    actor.permissions.has(PERMISSIONS.AUDIT_LOG_READ) ||
    actor.permissions.has(PERMISSIONS.DOCUMENT_REVIEW) ||
    actor.permissions.has(PERMISSIONS.UNIVERSITY_MANAGE);
  if (!isStaff) throw new AppError("FORBIDDEN", "Staff access required.");
  return actor;
}

/**
 * Object-level authorization: resolves the caller's own profile id or throws.
 *
 * Student-scoped queries must always filter by this rather than accepting a profileId
 * from the request — knowing another student's UUID must never be sufficient
 * (docs/13-authentication-authorization.md §7, docs/49-threat-model.md).
 */
export async function requireOwnProfileId(actor: Actor): Promise<string> {
  if (!actor.profileId) {
    throw new AppError("RESOURCE_NOT_FOUND", "No profile exists for this account.");
  }
  return actor.profileId;
}
