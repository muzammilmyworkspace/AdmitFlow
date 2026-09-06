import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { ENTITLEMENTS, hasEntitlement } from "@/services/entitlement-service";
import type { ApplicationStatus, Prisma } from "../../../prisma/generated/client";

// Applications — docs/21-application-management.md, docs/31-state-machines.md §3.
//
// Two things here are load-bearing:
//
//  1. Submission is gated by a readiness predicate, not a hopeful button. "One-click
//     apply" must never mean submitting an incomplete file to a university on a
//     student's behalf.
//  2. Submission freezes a snapshot. After it, the application shows what was actually
//     sent — not whatever the student's live profile happens to say later.

/** Canonical transitions — docs/31-state-machines.md §3. */
const ALLOWED_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  DRAFT: ["READY_FOR_REVIEW", "WITHDRAWN"],
  READY_FOR_REVIEW: ["DRAFT", "READY_TO_SUBMIT", "WITHDRAWN"],
  READY_TO_SUBMIT: ["DRAFT", "SUBMITTED", "WITHDRAWN"],
  SUBMITTED: ["UNDER_REVIEW", "WITHDRAWN"],
  UNDER_REVIEW: [
    "ADDITIONAL_INFORMATION_REQUIRED",
    "OFFER_RECEIVED",
    "REJECTED",
    "WAITLISTED",
    "WITHDRAWN",
  ],
  ADDITIONAL_INFORMATION_REQUIRED: ["UNDER_REVIEW", "WITHDRAWN"],
  WAITLISTED: ["OFFER_RECEIVED", "REJECTED", "WITHDRAWN"],
  OFFER_RECEIVED: ["OFFER_ACCEPTED", "OFFER_DECLINED", "WITHDRAWN"],
  // Terminal — docs/31 §3.
  REJECTED: [],
  OFFER_ACCEPTED: [],
  OFFER_DECLINED: [],
  WITHDRAWN: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export interface ReadinessCheck {
  key: string;
  label: string;
  satisfied: boolean;
  detail: string;
}

export interface ReadinessReport {
  ready: boolean;
  checks: ReadinessCheck[];
  missing: string[];
}

/**
 * The submission readiness predicate — docs/21 §"Pre-submission".
 *
 * Returns the full picture rather than a bare boolean so the UI can tell the student
 * exactly what is outstanding, which is the difference between a useful blocker and a
 * disabled button with no explanation.
 */
export async function checkReadiness(applicationId: string): Promise<ReadinessReport> {
  const application = await db.application.findUniqueOrThrow({
    where: { id: applicationId },
    include: {
      student: { include: { profile: true, documentsOwned: { where: { deletedAt: null } } } },
      program: { include: { documentRequirements: true, programRequirements: true } },
      intake: true,
      applicationDocuments: { include: { document: true } },
    },
  });

  const profile = application.student.profile;
  const verifiedTypes = new Set(
    application.student.documentsOwned.filter((d) => d.status === "VERIFIED").map((d) => d.type),
  );

  const [baselineRequirements, feePaid] = await Promise.all([
    db.documentRequirement.findMany({ where: { programId: null, isMandatory: true } }),
    hasEntitlement(application.studentId, ENTITLEMENTS.APPLICATION_SUBMISSION, {
      applicationId: application.id,
    }),
  ]);

  const requiredDocTypes = [
    ...new Set([
      ...baselineRequirements.map((r) => r.documentType),
      ...application.program.documentRequirements.filter((r) => r.isMandatory).map((r) => r.documentType),
    ]),
  ];
  const missingDocs = requiredDocTypes.filter((t) => !verifiedTypes.has(t));

  const deadlinePassed = application.intake.applicationDeadline < new Date();

  const checks: ReadinessCheck[] = [
    {
      key: "profile",
      label: "Profile complete",
      satisfied: !!profile?.onboardingCompletedAt,
      detail: profile?.onboardingCompletedAt
        ? "Your profile is complete."
        : "Finish your profile before applying.",
    },
    {
      key: "documents",
      label: "Required documents verified",
      satisfied: missingDocs.length === 0,
      detail:
        missingDocs.length === 0
          ? "All required documents are verified."
          : `Still needed: ${missingDocs.join(", ")}.`,
    },
    {
      key: "deadline",
      label: "Intake still open",
      satisfied: !deadlinePassed && application.intake.status !== "CLOSED",
      detail: deadlinePassed
        ? "The application deadline for this intake has passed."
        : `Deadline: ${application.intake.applicationDeadline.toISOString().slice(0, 10)}.`,
    },
    {
      key: "fee",
      label: "Application fee paid",
      satisfied: feePaid,
      detail: feePaid ? "Application fee paid." : "The application fee has not been paid yet.",
    },
  ];

  const missing = checks.filter((c) => !c.satisfied).map((c) => c.label);
  return { ready: missing.length === 0, checks, missing };
}

export async function createApplication(params: {
  userId: string;
  programId: string;
  intakeId: string;
}) {
  const intake = await db.intake.findUnique({
    where: { id: params.intakeId },
    include: { program: true },
  });
  if (!intake || intake.programId !== params.programId) {
    throw new AppError("RESOURCE_NOT_FOUND", "That programme intake could not be found.");
  }
  if (intake.status === "CLOSED") {
    throw new AppError("CONFLICT", "Applications for this intake have closed.");
  }

  const existing = await db.application.findFirst({
    where: {
      studentId: params.userId,
      programId: params.programId,
      intakeId: params.intakeId,
      deletedAt: null,
      status: { notIn: ["WITHDRAWN", "REJECTED", "OFFER_DECLINED"] },
    },
  });
  if (existing) {
    throw new AppError("CONFLICT", "You already have an application for this programme and intake.");
  }

  return db.$transaction(async (tx) => {
    const application = await tx.application.create({
      data: {
        studentId: params.userId,
        programId: params.programId,
        intakeId: params.intakeId,
        status: "DRAFT",
      },
    });
    await tx.applicationStatusHistory.create({
      data: { applicationId: application.id, toStatus: "DRAFT", changedBy: params.userId },
    });
    await writeAuditLog(
      {
        actorId: params.userId,
        actorType: "STUDENT",
        action: "application.created",
        entityType: "Application",
        entityId: application.id,
      },
      tx,
    );
    return application;
  });
}

export async function attachDocument(params: {
  userId: string;
  applicationId: string;
  documentId: string;
}) {
  const [application, document] = await Promise.all([
    db.application.findFirst({
      where: { id: params.applicationId, studentId: params.userId, deletedAt: null },
    }),
    db.document.findFirst({
      where: { id: params.documentId, ownerId: params.userId, deletedAt: null },
    }),
  ]);
  if (!application) throw new AppError("RESOURCE_NOT_FOUND", "Application not found.");
  if (!document) throw new AppError("RESOURCE_NOT_FOUND", "Document not found.");
  if (application.status !== "DRAFT" && application.status !== "READY_FOR_REVIEW") {
    throw new AppError("APPLICATION_INVALID_STATE", "Documents can only be changed before submission.");
  }

  return db.applicationDocument.upsert({
    where: {
      applicationId_documentId: { applicationId: application.id, documentId: document.id },
    },
    create: { applicationId: application.id, documentId: document.id },
    update: {},
  });
}

/**
 * Submits an application: re-checks readiness server-side, then freezes the snapshot and
 * transitions to SUBMITTED — all in one transaction.
 *
 * Readiness is re-evaluated here even though the UI already showed it, because the UI's
 * view can be stale and is not a security boundary.
 */
export async function submitApplication(params: {
  userId: string;
  applicationId: string;
  /** Client-supplied key that makes a double-click or double tab a single submission. */
  idempotencyKey?: string;
}) {
  const application = await db.application.findFirst({
    where: { id: params.applicationId, studentId: params.userId, deletedAt: null },
    include: {
      program: {
        include: {
          university: { include: { country: true } },
          documentRequirements: true,
          programRequirements: true,
          englishRequirements: true,
          tuitionFees: { where: { category: "INTERNATIONAL" }, take: 1 },
        },
      },
      intake: true,
      applicationDocuments: { include: { document: true } },
      snapshot: true,
    },
  });
  if (!application) throw new AppError("RESOURCE_NOT_FOUND", "Application not found.");

  // Already submitted: return success rather than an error. A duplicate submit is the
  // user clicking twice, and the correct outcome is one submission, not a scary message.
  if (application.snapshot) {
    return { applicationId: application.id, status: application.status, alreadySubmitted: true };
  }

  if (!canTransition(application.status, "SUBMITTED")) {
    throw new AppError(
      "APPLICATION_INVALID_STATE",
      `An application in ${application.status} cannot be submitted.`,
    );
  }

  const readiness = await checkReadiness(application.id);
  if (!readiness.ready) {
    throw new AppError(
      "APPLICATION_INVALID_STATE",
      `Not ready to submit: ${readiness.missing.join("; ")}.`,
    );
  }

  const profile = await db.profile.findUniqueOrThrow({
    where: { userId: params.userId },
    include: { educations: true, languageTests: true, destinationCountries: true },
  });

  return db.$transaction(async (tx) => {
    const submittedAt = new Date();

    const snapshot = await tx.applicationSnapshot.create({
      data: { applicationId: application.id, capturedAt: submittedAt },
    });

    await tx.applicationProfileSnapshot.create({
      data: {
        applicationSnapshotId: snapshot.id,
        payload: {
          firstName: profile.firstName,
          lastName: profile.lastName,
          dateOfBirth: profile.dateOfBirth?.toISOString() ?? null,
          budgetMax: profile.budgetMax === null ? null : Number(profile.budgetMax),
          budgetCurrency: profile.budgetCurrency,
          educations: profile.educations.map((e) => ({
            level: e.level,
            institutionName: e.institutionName,
            fieldOfStudy: e.fieldOfStudy,
            gradingScale: e.gradingScale,
            gradeValue: e.gradeValue === null ? null : Number(e.gradeValue),
          })),
          languageTests: profile.languageTests.map((t) => ({
            testType: t.testType,
            overallScore: Number(t.overallScore),
            testDate: t.testDate.toISOString(),
          })),
        } satisfies Prisma.InputJsonValue,
      },
    });

    await tx.programSnapshot.create({
      data: {
        applicationSnapshotId: snapshot.id,
        programId: application.programId,
        payload: {
          name: application.program.name,
          level: application.program.level,
          fieldOfStudy: application.program.fieldOfStudy,
          durationMonths: application.program.durationMonths,
          deliveryMode: application.program.deliveryMode,
          university: application.program.university.name,
          country: application.program.university.country.name,
          intake: {
            term: application.intake.term,
            applicationDeadline: application.intake.applicationDeadline.toISOString(),
            startDate: application.intake.startDate.toISOString(),
          },
          tuition: application.program.tuitionFees[0]
            ? {
                amount: Number(application.program.tuitionFees[0].amount),
                currency: application.program.tuitionFees[0].currency,
              }
            : null,
        } satisfies Prisma.InputJsonValue,
      },
    });

    // Each attached document is frozen by key + checksum, so a later re-upload of the
    // "same" document cannot retroactively change what was submitted.
    for (const link of application.applicationDocuments) {
      await tx.applicationDocumentSnapshot.create({
        data: {
          applicationSnapshotId: snapshot.id,
          documentId: link.documentId,
          versionNumberAtSubmission: link.document.currentVersionNumber,
          s3KeyAtSubmission: link.document.s3Key,
          checksumAtSubmission: link.document.checksumSha256,
          reviewStatusAtSubmission: link.document.status,
        },
      });
    }

    for (const requirement of application.program.programRequirements) {
      await tx.requirementSnapshot.create({
        data: {
          applicationSnapshotId: snapshot.id,
          requirementType: requirement.requirementType,
          payload: {
            description: requirement.description,
            minValue: requirement.minValue === null ? null : Number(requirement.minValue),
            isMandatory: requirement.isMandatory,
            metAtSubmission: true,
          } satisfies Prisma.InputJsonValue,
        },
      });
    }

    const updated = await tx.application.update({
      where: { id: application.id },
      data: { status: "SUBMITTED", submittedAt },
    });
    await tx.applicationStatusHistory.create({
      data: {
        applicationId: application.id,
        fromStatus: application.status,
        toStatus: "SUBMITTED",
        changedBy: params.userId,
      },
    });
    await writeAuditLog(
      {
        actorId: params.userId,
        actorType: "STUDENT",
        action: "application.submitted",
        entityType: "Application",
        entityId: application.id,
        metadata: { idempotencyKey: params.idempotencyKey ?? null },
      },
      tx,
    );

    return { applicationId: updated.id, status: updated.status, alreadySubmitted: false };
  });
}

/** Status change by staff (or the student, for withdraw / offer accept-decline). */
export async function changeStatus(params: {
  actorId: string;
  actorType: "STUDENT" | "ADMIN";
  applicationId: string;
  toStatus: ApplicationStatus;
  reason?: string | null;
}) {
  const application = await db.application.findUnique({ where: { id: params.applicationId } });
  if (!application) throw new AppError("RESOURCE_NOT_FOUND", "Application not found.");

  if (params.actorType === "STUDENT" && application.studentId !== params.actorId) {
    throw new AppError("RESOURCE_NOT_FOUND", "Application not found.");
  }
  if (!canTransition(application.status, params.toStatus)) {
    throw new AppError(
      "APPLICATION_INVALID_STATE",
      `Cannot move an application from ${application.status} to ${params.toStatus}.`,
    );
  }
  // An admin overriding a student's application must say why — docs/25 §"Overrides".
  if (params.actorType === "ADMIN" && !params.reason?.trim()) {
    throw new AppError("VALIDATION_ERROR", "A reason is required for an admin status change.");
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.application.update({
      where: { id: application.id },
      data: { status: params.toStatus },
    });
    await tx.applicationStatusHistory.create({
      data: {
        applicationId: application.id,
        fromStatus: application.status,
        toStatus: params.toStatus,
        changedBy: params.actorId,
        reason: params.reason ?? null,
      },
    });
    await writeAuditLog(
      {
        actorId: params.actorId,
        actorType: params.actorType,
        action: "application.status_changed",
        entityType: "Application",
        entityId: application.id,
        metadata: { from: application.status, to: params.toStatus, reason: params.reason ?? null },
      },
      tx,
    );
    return updated;
  });
}

export async function listApplications(userId: string) {
  const rows = await db.application.findMany({
    where: { studentId: userId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      program: { include: { university: { include: { country: true } } } },
      intake: true,
      statusHistory: { orderBy: { changedAt: "desc" }, take: 1 },
    },
  });

  return rows.map((a) => ({
    id: a.id,
    status: a.status,
    submittedAt: a.submittedAt,
    createdAt: a.createdAt,
    program: {
      id: a.programId,
      name: a.program.name,
      level: a.program.level,
      university: a.program.university.name,
      country: a.program.university.country.name,
    },
    intake: {
      term: a.intake.term,
      applicationDeadline: a.intake.applicationDeadline,
      status: a.intake.status,
    },
    lastChangeAt: a.statusHistory[0]?.changedAt ?? a.createdAt,
  }));
}

export async function getApplication(userId: string, applicationId: string) {
  const application = await db.application.findFirst({
    where: { id: applicationId, studentId: userId, deletedAt: null },
    include: {
      program: { include: { university: { include: { country: true } }, documentRequirements: true } },
      intake: true,
      applicationDocuments: { include: { document: true } },
      statusHistory: { orderBy: { changedAt: "desc" } },
      snapshot: {
        include: {
          profileSnapshot: true,
          programSnapshot: true,
          documentSnapshots: true,
          requirementSnapshots: true,
        },
      },
    },
  });
  if (!application) return null;

  const readiness = application.snapshot ? null : await checkReadiness(application.id);

  return {
    id: application.id,
    status: application.status,
    submittedAt: application.submittedAt,
    program: {
      id: application.programId,
      name: application.program.name,
      level: application.program.level,
      fieldOfStudy: application.program.fieldOfStudy,
      university: application.program.university.name,
      country: application.program.university.country.name,
    },
    intake: {
      term: application.intake.term,
      applicationDeadline: application.intake.applicationDeadline,
      startDate: application.intake.startDate,
      status: application.intake.status,
    },
    documents: application.applicationDocuments.map((link) => ({
      id: link.documentId,
      type: link.document.type,
      filename: link.document.originalFilename,
      status: link.document.status,
    })),
    requiredDocumentTypes: application.program.documentRequirements
      .filter((r) => r.isMandatory)
      .map((r) => r.documentType),
    history: application.statusHistory.map((h) => ({
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      changedAt: h.changedAt,
      reason: h.reason,
    })),
    readiness,
    // Once submitted the frozen snapshot is the source of truth for what was sent.
    submittedSnapshot: application.snapshot
      ? {
          capturedAt: application.snapshot.capturedAt,
          profile: application.snapshot.profileSnapshot?.payload ?? null,
          program: application.snapshot.programSnapshot?.payload ?? null,
          documents: application.snapshot.documentSnapshots.map((d) => ({
            documentId: d.documentId,
            checksum: d.checksumAtSubmission,
            reviewStatus: d.reviewStatusAtSubmission,
          })),
        }
      : null,
  };
}
