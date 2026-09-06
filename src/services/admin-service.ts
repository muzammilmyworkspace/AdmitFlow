import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import type { Prisma } from "../../prisma/generated/client";

// Admin back-office queries — docs/25-admin-platform.md.
//
// Every mutating operation in here is permission-gated at the route, requires a reason,
// and writes an audit row. The read paths are paginated: an admin list that loads every
// row is the same unbounded-query problem as anywhere else, just with a nicer job title.

const MAX_PAGE = 50;

export async function getPlatformStats() {
  const [
    students,
    activeStudents,
    applications,
    submittedApplications,
    pendingDocuments,
    universities,
    programs,
    payments,
    assessments,
  ] = await Promise.all([
    db.user.count({ where: { deletedAt: null } }),
    db.user.count({ where: { status: "ACTIVE", deletedAt: null } }),
    db.application.count({ where: { deletedAt: null } }),
    db.application.count({ where: { submittedAt: { not: null }, deletedAt: null } }),
    db.document.count({ where: { status: "PENDING_REVIEW", deletedAt: null } }),
    db.university.count({ where: { deletedAt: null } }),
    db.program.count({ where: { deletedAt: null } }),
    db.payment.aggregate({ where: { status: "SUCCEEDED" }, _sum: { amount: true }, _count: true }),
    db.assessmentResult.count(),
  ]);

  return {
    students,
    activeStudents,
    applications,
    submittedApplications,
    pendingDocuments,
    universities,
    programs,
    revenue: {
      total: payments._sum.amount ? Number(payments._sum.amount) : 0,
      count: payments._count,
    },
    assessments,
  };
}

export async function listUsers(params: { query?: string; cursor?: string; pageSize?: number }) {
  const pageSize = Math.min(params.pageSize ?? 25, MAX_PAGE);
  const where: Prisma.UserWhereInput = params.query
    ? {
        OR: [
          { email: { contains: params.query, mode: "insensitive" } },
          { profile: { firstName: { contains: params.query, mode: "insensitive" } } },
          { profile: { lastName: { contains: params.query, mode: "insensitive" } } },
        ],
      }
    : {};

  const rows = await db.user.findMany({
    where,
    take: pageSize + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    include: {
      profile: true,
      userRoles: { include: { role: true } },
      _count: { select: { applicationsAsStudent: true, documentsOwned: true } },
    },
  });

  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;

  return {
    users: items.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.profile ? `${u.profile.firstName} ${u.profile.lastName}` : null,
      status: u.status,
      roles: u.userRoles.map((r) => r.role.name),
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      applications: u._count.applicationsAsStudent,
      documents: u._count.documentsOwned,
    })),
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    hasMore,
  };
}

export async function getUserDetail(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      profile: { include: { educations: true, languageTests: true } },
      userRoles: { include: { role: true } },
      documentsOwned: { where: { deletedAt: null } },
      applicationsAsStudent: {
        where: { deletedAt: null },
        include: { program: true, intake: true },
      },
      customer: {
        include: {
          entitlements: { include: { product: true }, orderBy: { grantedAt: "desc" } },
          purchases: { include: { price: { include: { product: true } } }, orderBy: { createdAt: "desc" } },
        },
      },
    },
  });
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    roles: user.userRoles.map((r) => r.role.name),
    profile: user.profile
      ? {
          firstName: user.profile.firstName,
          lastName: user.profile.lastName,
          onboardingCompletedAt: user.profile.onboardingCompletedAt,
          educationCount: user.profile.educations.length,
          languageTestCount: user.profile.languageTests.length,
        }
      : null,
    documents: user.documentsOwned.map((d) => ({
      id: d.id,
      type: d.type,
      status: d.status,
      filename: d.originalFilename,
      createdAt: d.createdAt,
    })),
    applications: user.applicationsAsStudent.map((a) => ({
      id: a.id,
      status: a.status,
      program: a.program.name,
      term: a.intake.term,
      submittedAt: a.submittedAt,
    })),
    entitlements:
      user.customer?.entitlements.map((e) => ({
        id: e.id,
        product: e.product.key,
        sourceType: e.sourceType,
        grantedAt: e.grantedAt,
        revokedAt: e.revokedAt,
        revokedReason: e.revokedReason,
      })) ?? [],
    purchases:
      user.customer?.purchases.map((p) => ({
        id: p.id,
        product: p.price.product.key,
        amount: Number(p.price.amount),
        currency: p.price.currency,
        status: p.status,
        createdAt: p.createdAt,
      })) ?? [],
  };
}

/**
 * Suspend / reactivate an account.
 *
 * Suspension revokes every live session immediately — leaving a suspended user with a
 * working cookie would make the control cosmetic (docs/31-state-machines.md §1, A6).
 */
export async function setUserStatus(params: {
  actorId: string;
  targetUserId: string;
  status: "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
  reason: string;
}) {
  if (!params.reason.trim()) {
    throw new AppError("VALIDATION_ERROR", "A reason is required to change an account's status.");
  }
  if (params.actorId === params.targetUserId) {
    throw new AppError("CONFLICT", "You cannot change your own account status.");
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: params.targetUserId },
      data: { status: params.status },
    });
    if (params.status !== "ACTIVE") {
      await tx.session.updateMany({
        where: { userId: params.targetUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await writeAuditLog(
      {
        actorId: params.actorId,
        actorType: "ADMIN",
        action: "admin.action",
        entityType: "User",
        entityId: params.targetUserId,
        metadata: { subtype: `USER_${params.status}`, reason: params.reason },
      },
      tx,
    );
    return updated;
  });
}

export async function listApplicationsForReview(params: {
  status?: string;
  cursor?: string;
  pageSize?: number;
}) {
  const pageSize = Math.min(params.pageSize ?? 25, MAX_PAGE);
  const rows = await db.application.findMany({
    where: {
      deletedAt: null,
      ...(params.status ? { status: params.status as Prisma.ApplicationWhereInput["status"] } : {}),
    },
    take: pageSize + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    include: {
      student: { include: { profile: true } },
      program: { include: { university: true } },
      intake: true,
    },
  });

  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;

  return {
    applications: items.map((a) => ({
      id: a.id,
      status: a.status,
      submittedAt: a.submittedAt,
      student: {
        id: a.studentId,
        email: a.student.email,
        name: a.student.profile
          ? `${a.student.profile.firstName} ${a.student.profile.lastName}`
          : a.student.email,
      },
      program: a.program.name,
      university: a.program.university.name,
      term: a.intake.term,
    })),
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    hasMore,
  };
}

export async function listAuditLog(params: {
  entityType?: string;
  actorId?: string;
  cursor?: string;
  pageSize?: number;
}) {
  const pageSize = Math.min(params.pageSize ?? 50, MAX_PAGE);
  const rows = await db.auditLog.findMany({
    where: {
      ...(params.entityType ? { entityType: params.entityType } : {}),
      ...(params.actorId ? { actorId: params.actorId } : {}),
    },
    take: pageSize + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    include: { actor: { select: { email: true } } },
  });

  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;

  return {
    entries: items.map((e) => ({
      id: e.id,
      action: e.action,
      actorType: e.actorType,
      actorEmail: e.actor?.email ?? null,
      entityType: e.entityType,
      entityId: e.entityId,
      metadata: e.metadata,
      ipAddress: e.ipAddress,
      createdAt: e.createdAt,
    })),
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    hasMore,
  };
}
