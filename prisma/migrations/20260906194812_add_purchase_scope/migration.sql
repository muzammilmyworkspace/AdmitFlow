-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "scope" JSONB;
