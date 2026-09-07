-- CreateEnum
CREATE TYPE "AssessmentReviewStatus" AS ENUM ('REQUESTED', 'IN_REVIEW', 'COMPLETED', 'CANCELED');

-- CreateTable
CREATE TABLE "AssessmentReview" (
    "id" TEXT NOT NULL,
    "assessmentResultId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "status" "AssessmentReviewStatus" NOT NULL DEFAULT 'REQUESTED',
    "studentNote" TEXT,
    "reviewerNotes" TEXT,
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentReview_status_createdAt_idx" ON "AssessmentReview"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AssessmentReview_studentId_status_idx" ON "AssessmentReview"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentReview_assessmentResultId_key" ON "AssessmentReview"("assessmentResultId");

-- AddForeignKey
ALTER TABLE "AssessmentReview" ADD CONSTRAINT "AssessmentReview_assessmentResultId_fkey" FOREIGN KEY ("assessmentResultId") REFERENCES "AssessmentResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentReview" ADD CONSTRAINT "AssessmentReview_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentReview" ADD CONSTRAINT "AssessmentReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
