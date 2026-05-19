ALTER TABLE "User" ADD COLUMN "topicSubmissionLocked" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Topic" ADD COLUMN "aiReviewStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "Topic" ADD COLUMN "aiRiskLevel" TEXT;
ALTER TABLE "Topic" ADD COLUMN "aiRiskScore" INTEGER;
ALTER TABLE "Topic" ADD COLUMN "aiReviewReason" TEXT;
ALTER TABLE "Topic" ADD COLUMN "aiReviewDetail" TEXT;
ALTER TABLE "Topic" ADD COLUMN "aiModel" TEXT;
ALTER TABLE "Topic" ADD COLUMN "aiReviewedAt" DATETIME;
ALTER TABLE "Topic" ADD COLUMN "manualReviewedById" INTEGER;
ALTER TABLE "Topic" ADD COLUMN "manualReviewedAt" DATETIME;
ALTER TABLE "Topic" ADD COLUMN "manualReviewNote" TEXT;

CREATE INDEX "Topic_authorId_aiReviewStatus_idx" ON "Topic"("authorId", "aiReviewStatus");

