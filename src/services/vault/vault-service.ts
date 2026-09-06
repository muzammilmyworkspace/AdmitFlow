import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { getStorage } from "@/lib/storage";
import { writeAuditLog } from "@/lib/audit";
import { validateFileContent, scanForMalware, MAX_FILE_BYTES } from "./file-validation";
import type { DocumentStatus, DocumentType, Prisma } from "../../../prisma/generated/client";

// Document vault — docs/15-document-vault-security.md.
//
// Invariants this module enforces:
//   * bytes live only in private object storage, never in the database or a public path
//   * every read/write is authorized against the caller, per request, per object
//   * object keys are server-generated and non-guessable, never derived from a filename
//   * the browser's claimed type is never trusted — content is verified server-side
//   * every state change writes a DocumentAuditLog row in the same transaction

const UPLOAD_TTL_SECONDS = 120; // docs/54-decision-log.md D-10
const DOWNLOAD_TTL_SECONDS = 60;

/** Non-guessable, non-filename-derived key — docs/15 §6. */
function buildStorageKey(userId: string, documentId: string, version: number): string {
  return `vault/${userId}/${documentId}/v${version}-${randomUUID()}`;
}

export async function initiateUpload(params: {
  userId: string;
  type: DocumentType;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}) {
  if (params.sizeBytes > MAX_FILE_BYTES) {
    throw new AppError(
      "FILE_TOO_LARGE",
      `Files must be ${MAX_FILE_BYTES / (1024 * 1024)}MB or smaller.`,
    );
  }

  const documentId = randomUUID();
  const storageKey = buildStorageKey(params.userId, documentId, 1);
  const storage = getStorage();

  const document = await db.$transaction(async (tx) => {
    const created = await tx.document.create({
      data: {
        id: documentId,
        ownerId: params.userId,
        type: params.type,
        s3Bucket: getEnv().S3_BUCKET,
        s3Key: storageKey,
        // Kept for display only. Never used to resolve a path or decide a type.
        originalFilename: params.filename.slice(0, 255),
        mimeType: params.mimeType,
        sizeBytes: BigInt(params.sizeBytes),
        checksumSha256: "",
        status: "UPLOAD_INITIATED",
        currentVersionNumber: 1,
      },
    });
    await tx.documentAuditLog.create({
      data: {
        documentId: created.id,
        actorId: params.userId,
        actorType: "STUDENT",
        action: "UPLOAD_INITIATED",
        toStatus: "UPLOAD_INITIATED",
      },
    });
    return created;
  });

  const uploadUrl = await storage.createUploadUrl(storageKey, params.mimeType, UPLOAD_TTL_SECONDS);

  return {
    documentId: document.id,
    uploadUrl,
    storageKey,
    expiresInSeconds: UPLOAD_TTL_SECONDS,
  };
}

/**
 * Confirms an upload: verifies the bytes actually landed, checks the real content type,
 * runs the malware scan, and advances the state machine.
 *
 * The client calling this is not trusted to say the upload succeeded — the server reads
 * the object back and decides.
 */
export async function confirmUpload(params: { userId: string; documentId: string }) {
  const document = await db.document.findFirst({
    where: { id: params.documentId, ownerId: params.userId, deletedAt: null },
  });
  if (!document) throw new AppError("RESOURCE_NOT_FOUND", "Document not found.");
  if (document.status !== "UPLOAD_INITIATED") {
    throw new AppError("CONFLICT", "This upload has already been confirmed.");
  }

  const storage = getStorage();
  let buffer: Buffer;
  try {
    buffer = await storage.getObject(document.s3Key);
  } catch {
    throw new AppError("FILE_INVALID", "No uploaded file was found. Please try uploading again.");
  }

  const validation = validateFileContent(buffer, document.mimeType, document.originalFilename);
  if (!validation.ok) {
    await rejectDocument({
      documentId: document.id,
      actorId: null,
      actorType: "SYSTEM",
      reasonCode: "invalid_file",
      notes: validation.reason ?? "File validation failed.",
    });
    throw new AppError("FILE_INVALID", validation.reason ?? "That file could not be accepted.");
  }

  const verdict = await scanForMalware(buffer);
  if (verdict === "INFECTED") {
    // Quarantine, never silent deletion — docs/15 §5. The object is moved out of the
    // vault prefix so it can be investigated, and the row records why.
    await storage.putObject(`quarantine/${document.id}`, buffer, document.mimeType);
    await storage.deleteObject(document.s3Key);
    await rejectDocument({
      documentId: document.id,
      actorId: null,
      actorType: "SYSTEM",
      reasonCode: "suspected_malware",
      notes: "Malware scan flagged this file. It has been quarantined.",
    });
    throw new AppError("FILE_INVALID", "This file was flagged by our malware scan.");
  }

  const checksum = createHash("sha256").update(buffer).digest("hex");

  return db.$transaction(async (tx) => {
    const updated = await tx.document.update({
      where: { id: document.id },
      data: {
        status: "PENDING_REVIEW",
        checksumSha256: checksum,
        sizeBytes: BigInt(buffer.length),
      },
    });
    await tx.documentAuditLog.create({
      data: {
        documentId: document.id,
        actorId: params.userId,
        actorType: "STUDENT",
        action: "UPLOAD_CONFIRMED",
        fromStatus: "UPLOAD_INITIATED",
        toStatus: "PENDING_REVIEW",
        metadata: { scanVerdict: verdict, detectedMime: validation.detectedMime },
      },
    });
    return updated;
  });
}

/**
 * Issues a short-lived download URL, after checking this specific caller may read this
 * specific object. Every issuance is logged — docs/15 §8.
 */
export async function createDownloadUrl(params: {
  documentId: string;
  actorId: string;
  /** True when the caller is staff exercising document:download_any. */
  isStaff: boolean;
}) {
  const document = await db.document.findFirst({
    where: { id: params.documentId, deletedAt: null },
  });
  // Same response whether it doesn't exist or isn't theirs — an id probe learns nothing.
  if (!document) throw new AppError("DOCUMENT_ACCESS_DENIED", "Document not found.");
  if (document.ownerId !== params.actorId && !params.isStaff) {
    throw new AppError("DOCUMENT_ACCESS_DENIED", "Document not found.");
  }

  const url = await getStorage().createDownloadUrl(document.s3Key, DOWNLOAD_TTL_SECONDS);

  await db.documentAuditLog.create({
    data: {
      documentId: document.id,
      actorId: params.actorId,
      actorType: params.isStaff ? "ADMIN" : "STUDENT",
      action: "SIGNED_URL_ISSUED",
      metadata: { ttlSeconds: DOWNLOAD_TTL_SECONDS },
    },
  });

  return { url, expiresInSeconds: DOWNLOAD_TTL_SECONDS };
}

export async function listDocuments(userId: string) {
  const [documents, requirements] = await Promise.all([
    db.document.findMany({
      where: { ownerId: userId, deletedAt: null, status: { not: "DELETED" } },
      orderBy: { createdAt: "desc" },
      include: { reviews: { orderBy: { reviewedAt: "desc" }, take: 1 } },
    }),
    db.documentRequirement.findMany({ where: { programId: null } }),
  ]);

  const byType = new Map(documents.map((d) => [d.type, d]));

  return {
    documents: documents.map((d) => ({
      id: d.id,
      type: d.type,
      originalFilename: d.originalFilename,
      mimeType: d.mimeType,
      sizeBytes: Number(d.sizeBytes),
      status: d.status,
      createdAt: d.createdAt,
      version: d.currentVersionNumber,
      latestReview: d.reviews[0]
        ? {
            outcome: d.reviews[0].outcome,
            reasonCode: d.reviews[0].reasonCode,
            notes: d.reviews[0].notes,
            reviewedAt: d.reviews[0].reviewedAt,
          }
        : null,
    })),
    // The requirements engine surfaces REQUIRED/MISSING — states that exist before any
    // Document row does (docs/10-database-schema.md §5.1.1).
    requirements: requirements.map((r) => {
      const existing = byType.get(r.documentType);
      return {
        documentType: r.documentType,
        isMandatory: r.isMandatory,
        description: r.description,
        status: existing ? existing.status : ("MISSING" as DocumentStatus | "MISSING"),
        documentId: existing?.id ?? null,
      };
    }),
  };
}

export async function deleteDocument(params: { userId: string; documentId: string }) {
  const document = await db.document.findFirst({
    where: { id: params.documentId, ownerId: params.userId, deletedAt: null },
  });
  if (!document) throw new AppError("RESOURCE_NOT_FOUND", "Document not found.");

  // Blocked while an active application's snapshot references it — docs/31 §2, D13.
  const referenced = await db.applicationDocumentSnapshot.findFirst({
    where: {
      documentId: document.id,
      applicationSnapshot: {
        application: {
          status: { notIn: ["WITHDRAWN", "REJECTED", "OFFER_DECLINED"] },
        },
      },
    },
  });
  if (referenced) {
    throw new AppError(
      "CONFLICT",
      "This document was submitted with an active application and cannot be deleted.",
    );
  }

  return db.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: document.id },
      data: { status: "DELETED", deletedAt: new Date() },
    });
    await tx.documentAuditLog.create({
      data: {
        documentId: document.id,
        actorId: params.userId,
        actorType: "STUDENT",
        action: "DELETED",
        fromStatus: document.status,
        toStatus: "DELETED",
      },
    });
  });
}

/** Staff review — approve. docs/15 §8.1, docs/31 §2 (D9). */
export async function verifyDocument(params: {
  documentId: string;
  reviewerId: string;
  notes?: string | null;
}) {
  const document = await db.document.findUniqueOrThrow({ where: { id: params.documentId } });
  if (document.status !== "PENDING_REVIEW") {
    throw new AppError("CONFLICT", "Only documents awaiting review can be verified.");
  }

  return db.$transaction(async (tx) => {
    await tx.documentReview.create({
      data: {
        documentId: document.id,
        reviewerId: params.reviewerId,
        versionNumber: document.currentVersionNumber,
        outcome: "APPROVED",
        notes: params.notes ?? null,
      },
    });
    const updated = await tx.document.update({
      where: { id: document.id },
      data: { status: "VERIFIED" },
    });
    await tx.documentAuditLog.create({
      data: {
        documentId: document.id,
        actorId: params.reviewerId,
        actorType: "ADMIN",
        action: "REVIEW_RECORDED",
        fromStatus: "PENDING_REVIEW",
        toStatus: "VERIFIED",
      },
    });
    await writeAuditLog(
      {
        actorId: params.reviewerId,
        actorType: "ADMIN",
        action: "document.verified",
        entityType: "Document",
        entityId: document.id,
      },
      tx,
    );
    return updated;
  });
}

/**
 * Staff review — reject. A reason code is mandatory: "rejected, no reason" leaves the
 * student with nothing to act on (docs/10-database-schema.md §5.3).
 */
export async function rejectDocument(params: {
  documentId: string;
  actorId: string | null;
  actorType?: "ADMIN" | "SYSTEM";
  reasonCode: string;
  notes?: string | null;
}) {
  if (!params.reasonCode) {
    throw new AppError("VALIDATION_ERROR", "A reason code is required to reject a document.");
  }
  const document = await db.document.findUniqueOrThrow({ where: { id: params.documentId } });

  return db.$transaction(async (tx) => {
    if (params.actorId) {
      await tx.documentReview.create({
        data: {
          documentId: document.id,
          reviewerId: params.actorId,
          versionNumber: document.currentVersionNumber,
          outcome: "REJECTED",
          reasonCode: params.reasonCode,
          notes: params.notes ?? null,
        },
      });
    }
    const updated = await tx.document.update({
      where: { id: document.id },
      data: { status: "REJECTED" },
    });
    await tx.documentAuditLog.create({
      data: {
        documentId: document.id,
        actorId: params.actorId,
        actorType: params.actorType ?? "ADMIN",
        action: "REVIEW_RECORDED",
        fromStatus: document.status,
        toStatus: "REJECTED",
        metadata: { reasonCode: params.reasonCode } as Prisma.InputJsonValue,
      },
    });
    if (params.actorId) {
      await writeAuditLog(
        {
          actorId: params.actorId,
          actorType: "ADMIN",
          action: "document.rejected",
          entityType: "Document",
          entityId: document.id,
          metadata: { reasonCode: params.reasonCode },
        },
        tx,
      );
    }
    return updated;
  });
}

/** The staff review queue. */
export async function listPendingReviews(limit = 50) {
  return db.document
    .findMany({
      where: { status: "PENDING_REVIEW", deletedAt: null },
      orderBy: { createdAt: "asc" },
      take: limit,
      include: { owner: { include: { profile: true } } },
    })
    .then((rows) =>
      rows.map((d) => ({
        id: d.id,
        type: d.type,
        originalFilename: d.originalFilename,
        sizeBytes: Number(d.sizeBytes),
        createdAt: d.createdAt,
        student: {
          id: d.owner.id,
          email: d.owner.email,
          name: d.owner.profile
            ? `${d.owner.profile.firstName} ${d.owner.profile.lastName}`
            : d.owner.email,
        },
      })),
    );
}
