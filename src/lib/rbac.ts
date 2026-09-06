import { AppError } from "./errors";

// RBAC primitives — docs/13-authentication-authorization.md.
// Permissions are granular capabilities; roles are named bundles. Future roles
// (UNIVERSITY_MANAGER, APPLICATION_REVIEWER, etc.) slot in as new bundles, never new code paths.
// Authorization is always server-side and object-level — a valid session + a guessed ID is
// never sufficient (docs/54-decision-log.md D-5 and the object-level-authorization rule).

export const SYSTEM_ROLES = {
  STUDENT: "STUDENT",
  CONSULTANT: "CONSULTANT",
  ADMIN: "ADMIN",
  SUPER_ADMIN: "SUPER_ADMIN",
} as const;

export type SystemRole = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

// Dot-namespaced permission keys — docs/10-database-schema.md §2.3.
export const PERMISSIONS = {
  DOCUMENT_REVIEW: "document:review",
  DOCUMENT_DOWNLOAD_ANY: "document:download_any",
  ENTITLEMENT_GRANT: "entitlement:grant",
  ENTITLEMENT_OVERRIDE: "entitlement:override",
  APPLICATION_SUBMIT_ON_BEHALF: "application:submit_on_behalf",
  APPLICATION_STATUS_OVERRIDE: "application:status_override",
  PAYMENT_REFUND: "payment:refund",
  UNIVERSITY_MANAGE: "university:manage",
  ASSESSMENT_RULES_PUBLISH: "assessment_rules:publish",
  AUDIT_LOG_READ: "audit_log:read",
  ADMIN_IMPERSONATE: "admin:impersonate",
  FEATURE_FLAG_MANAGE: "feature_flag:manage",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// Default permission bundles for the seeded system roles — the source of truth once
// seeded is the Role/Permission/RolePermission tables in Postgres, not this object;
// this is only the deterministic seed input (docs/37-seed-data-strategy.md).
export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRole, PermissionKey[]> = {
  STUDENT: [],
  CONSULTANT: [],
  ADMIN: [
    PERMISSIONS.DOCUMENT_REVIEW,
    PERMISSIONS.DOCUMENT_DOWNLOAD_ANY,
    PERMISSIONS.ENTITLEMENT_GRANT,
    PERMISSIONS.APPLICATION_STATUS_OVERRIDE,
    PERMISSIONS.UNIVERSITY_MANAGE,
    PERMISSIONS.AUDIT_LOG_READ,
  ],
  SUPER_ADMIN: Object.values(PERMISSIONS),
};

export interface ActorContext {
  userId: string;
  roles: SystemRole[];
  permissions: Set<PermissionKey>;
}

export function hasPermission(actor: ActorContext, permission: PermissionKey): boolean {
  return actor.permissions.has(permission);
}

export function requirePermission(actor: ActorContext, permission: PermissionKey): void {
  if (!hasPermission(actor, permission)) {
    throw new AppError("FORBIDDEN", `Missing required permission: ${permission}`);
  }
}
