import { describe, expect, it } from "vitest";
import { hasPermission, requirePermission, PERMISSIONS, type ActorContext, type PermissionKey } from "./rbac";
import { AppError } from "./errors";

// Unit tests for permission checks — docs/35-testing-strategy.md calls these out as
// Tier-0/security-path logic requiring high coverage.

function actorWith(permissions: PermissionKey[]): ActorContext {
  return { userId: "user-1", roles: [], permissions: new Set(permissions) };
}

describe("rbac", () => {
  it("grants access when the actor has the permission", () => {
    const actor = actorWith([PERMISSIONS.DOCUMENT_REVIEW]);
    expect(hasPermission(actor, PERMISSIONS.DOCUMENT_REVIEW)).toBe(true);
  });

  it("denies access when the actor lacks the permission", () => {
    const actor = actorWith([]);
    expect(hasPermission(actor, PERMISSIONS.ENTITLEMENT_GRANT)).toBe(false);
  });

  it("requirePermission throws a FORBIDDEN AppError when missing", () => {
    const actor = actorWith([]);
    expect(() => requirePermission(actor, PERMISSIONS.PAYMENT_REFUND)).toThrow(AppError);
  });

  it("requirePermission does not throw when the permission is present", () => {
    const actor = actorWith([PERMISSIONS.PAYMENT_REFUND]);
    expect(() => requirePermission(actor, PERMISSIONS.PAYMENT_REFUND)).not.toThrow();
  });
});
