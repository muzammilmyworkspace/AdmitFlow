import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { notify } from "@/services/notifications/notification-service";
import { ENTITLEMENTS, hasEntitlement } from "@/services/entitlement-service";
import type { AssessmentReviewStatus, Prisma } from "../../../prisma/generated/client";

// The paid human read of an automated assessment — docs/18-paywall-and-entitlements.md.
//
// The engine can explain how it scored a programme, but it cannot tell a student which of
// three good options actually suits them, or that their personal statement is the thing
// holding the whole application back. That judgement is what a consultant is for.
//
// The order is fixed and not negotiable at the call site:
//   pay -> provider webhook -> entitlement row -> THEN a review can be requested.
// requestReview() consults the entitlement ledger and nothing else. There is deliberately
// no parameter by which a caller can assert that the student has paid.

const MAX_NOTE = 2000;
const MIN_DELIVERED_REVIEW = 20;
const MAX_DELIVERED_REVIEW = 20_000;

export interface ReviewView {
  id: string;
  status: AssessmentReviewStatus;
  studentNote: string | null;
  reviewerNotes: string | null;
  requestedAt: string;
  completedAt: string | null;
  /** Set only once the review is delivered, so the student knows who wrote it. */
  reviewerName: string | null;
}

/** What the student may do about a review right now, for rendering the offer. */
export interface ReviewOffer {
  review: ReviewView | null;
  /** Paid for but not yet requested — the student still has to say what to look at. */
  isPurchased: boolean;
}

interface NamedUser {
  profile: { firstName: string; lastName: string } | null;
}

interface ReviewRow {
  id: string;
  status: AssessmentReviewStatus;
  studentNote: string | null;
  reviewerNotes: string | null;
  createdAt: Date;
  completedAt: Date | null;
  reviewer?: NamedUser | null;
}

// Names live on Profile, not User — staff accounts can exist before a profile does.
const NAME_SELECT = { select: { profile: { select: { firstName: true, lastName: true } } } };

function fullName(user: NamedUser | null | undefined): string | null {
  if (!user?.profile) return null;
  return [user.profile.firstName, user.profile.lastName].filter(Boolean).join(" ") || null;
}

function toView(row: ReviewRow): ReviewView {
  const isDelivered = row.status === "COMPLETED";
  return {
    id: row.id,
    status: row.status,
    studentNote: row.studentNote,
    // A reviewer's working draft is not the deliverable. The student reads it when the
    // review is marked complete, not while it is being written.
    reviewerNotes: isDelivered ? row.reviewerNotes : null,
    requestedAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    reviewerName: isDelivered ? fullName(row.reviewer) : null,
  };
}

/**
 * Resolves a result the caller is allowed to act on.
 *
 * Knowing a result id must never be enough, so ownership is checked against the database
 * here rather than trusted from the caller (docs/49-threat-model.md §5).
 */
async function requireOwnedResult(userId: string, resultId: string) {
  const result = await db.assessmentResult.findUnique({
    where: { id: resultId },
    select: { id: true, assessmentId: true, profileId: true },
  });
  if (!result) throw new AppError("RESOURCE_NOT_FOUND", "That assessment result does not exist.");

  const owner = await db.profile.findUnique({
    where: { id: result.profileId },
    select: { userId: true },
  });
  // Deliberately the same error as a missing row: distinguishing "not yours" from "no
  // such thing" would turn this endpoint into an oracle for which result ids exist.
  if (!owner || owner.userId !== userId) {
    throw new AppError("RESOURCE_NOT_FOUND", "That assessment result does not exist.");
  }
  return result;
}

/** What the student may currently do about a consultant review of this result. */
export async function getReviewOffer(userId: string, resultId: string): Promise<ReviewOffer> {
  const result = await requireOwnedResult(userId, resultId);

  const [row, isPurchased] = await Promise.all([
    db.assessmentReview.findUnique({
      where: { assessmentResultId: result.id },
      include: { reviewer: NAME_SELECT },
    }),
    hasEntitlement(userId, ENTITLEMENTS.ASSESSMENT_REVIEW, { assessmentId: result.assessmentId }),
  ]);

  return { review: row ? toView(row) : null, isPurchased };
}

/**
 * Opens a review request. Requires the entitlement — which is to say, requires that a
 * payment has already been confirmed by the provider's webhook.
 */
export async function requestReview(params: {
  userId: string;
  resultId: string;
  studentNote?: string | null;
}): Promise<ReviewView> {
  const result = await requireOwnedResult(params.userId, params.resultId);

  const paid = await hasEntitlement(params.userId, ENTITLEMENTS.ASSESSMENT_REVIEW, {
    assessmentId: result.assessmentId,
  });
  if (!paid) {
    throw new AppError(
      "PAYMENT_REQUIRED",
      "A consultant review has not been purchased for this assessment.",
    );
  }

  const note = params.studentNote?.trim() || null;
  if (note && note.length > MAX_NOTE) {
    throw new AppError("VALIDATION_ERROR", `Keep your note to ${MAX_NOTE} characters or fewer.`);
  }

  const existing = await db.assessmentReview.findUnique({
    where: { assessmentResultId: result.id },
  });
  // The unique index makes one-review-per-result a database guarantee; checking first
  // turns the race into a clear message rather than a constraint violation.
  if (existing) {
    throw new AppError("CONFLICT", "A review has already been requested for this assessment.");
  }

  const created = await db.assessmentReview.create({
    data: {
      assessmentResultId: result.id,
      profileId: result.profileId,
      studentId: params.userId,
      studentNote: note,
    },
  });

  await writeAuditLog({
    actorId: params.userId,
    actorType: "STUDENT",
    action: "assessment_review.requested",
    entityType: "AssessmentReview",
    entityId: created.id,
    // The note is the student's own account of their situation. Reference the row; do
    // not copy its contents into the audit trail.
    metadata: { assessmentResultId: result.id, hasNote: note !== null },
  });

  return toView(created);
}

// ---------------------------------------------------------------------------
// Reviewer side. Every route below is gated on PERMISSIONS.ASSESSMENT_REVIEW_DELIVER.
// ---------------------------------------------------------------------------

export async function listReviewQueue(params: { status?: AssessmentReviewStatus } = {}) {
  // Built separately and typed: inlining the ternary widens the argument enough that
  // Prisma stops inferring the include, and the relations vanish from the row type.
  const where: Prisma.AssessmentReviewWhereInput = params.status
    ? { status: params.status }
    : { status: { in: ["REQUESTED", "IN_REVIEW"] } };

  const rows = await db.assessmentReview.findMany({
    where,
    include: {
      student: NAME_SELECT,
      reviewer: NAME_SELECT,
      assessmentResult: { select: { id: true, generatedAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    studentName: fullName(row.student) ?? "Student",
    studentNote: row.studentNote,
    assessmentResultId: row.assessmentResult.id,
    assessedAt: row.assessmentResult.generatedAt.toISOString(),
    requestedAt: row.createdAt.toISOString(),
    claimedBy: fullName(row.reviewer),
  }));
}

/** Claims an open review. Losing the race is a conflict, not a silent takeover. */
export async function claimReview(params: { reviewerId: string; reviewId: string }) {
  // Conditional update rather than read-then-write: two consultants opening the queue at
  // the same moment must not both believe they own the same review.
  const claimed = await db.assessmentReview.updateMany({
    where: { id: params.reviewId, status: "REQUESTED", reviewerId: null },
    data: { reviewerId: params.reviewerId, status: "IN_REVIEW", claimedAt: new Date() },
  });
  if (claimed.count === 0) {
    throw new AppError("CONFLICT", "That review has already been claimed, or is not open.");
  }

  await writeAuditLog({
    actorId: params.reviewerId,
    actorType: "CONSULTANT",
    action: "assessment_review.claimed",
    entityType: "AssessmentReview",
    entityId: params.reviewId,
  });

  return db.assessmentReview.findUniqueOrThrow({ where: { id: params.reviewId } });
}

/** Delivers the review. This is the moment the student's money buys something. */
export async function completeReview(params: {
  reviewerId: string;
  reviewId: string;
  notes: string;
}) {
  const notes = params.notes.trim();
  if (notes.length < MIN_DELIVERED_REVIEW) {
    throw new AppError(
      "VALIDATION_ERROR",
      "A delivered review needs actual written feedback for the student.",
    );
  }
  if (notes.length > MAX_DELIVERED_REVIEW) {
    throw new AppError("VALIDATION_ERROR", "That review is too long to store.");
  }

  const review = await db.assessmentReview.findUnique({ where: { id: params.reviewId } });
  if (!review) throw new AppError("RESOURCE_NOT_FOUND", "That review does not exist.");
  if (review.status === "COMPLETED") {
    throw new AppError("CONFLICT", "That review has already been delivered.");
  }
  // A consultant may only deliver what they claimed. Reassignment goes through
  // claimReview, so there is no path here that quietly takes over another's work.
  if (review.reviewerId && review.reviewerId !== params.reviewerId) {
    throw new AppError("FORBIDDEN", "That review is assigned to another consultant.");
  }

  const updated = await db.$transaction(async (tx: Prisma.TransactionClient) => {
    const row = await tx.assessmentReview.update({
      where: { id: params.reviewId },
      data: {
        reviewerId: params.reviewerId,
        reviewerNotes: notes,
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });
    await writeAuditLog(
      {
        actorId: params.reviewerId,
        actorType: "CONSULTANT",
        action: "assessment_review.completed",
        entityType: "AssessmentReview",
        entityId: row.id,
        // The feedback is the student's private content — reference it, never copy it.
        metadata: { studentId: row.studentId, length: notes.length },
      },
      tx,
    );
    return row;
  });

  // Outside the transaction: notify() is a sink and must never be able to roll back a
  // review that was genuinely delivered (docs/23-notification-system.md §1).
  await notify({
    userId: updated.studentId,
    event: "ASSESSMENT_REVIEW_READY",
    context: { resultsUrl: "/dashboard/assessment" },
  });

  return updated;
}
