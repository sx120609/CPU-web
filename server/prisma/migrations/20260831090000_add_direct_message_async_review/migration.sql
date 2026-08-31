ALTER TABLE "DirectMessage" ADD COLUMN IF NOT EXISTS "hidden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DirectMessage" ADD COLUMN IF NOT EXISTS "aiReviewStatus" TEXT NOT NULL DEFAULT 'auto_passed';
ALTER TABLE "DirectMessage" ADD COLUMN IF NOT EXISTS "aiRiskLevel" TEXT;
ALTER TABLE "DirectMessage" ADD COLUMN IF NOT EXISTS "aiRiskScore" INTEGER;
ALTER TABLE "DirectMessage" ADD COLUMN IF NOT EXISTS "aiReviewReason" TEXT;
ALTER TABLE "DirectMessage" ADD COLUMN IF NOT EXISTS "aiReviewDetail" TEXT;
ALTER TABLE "DirectMessage" ADD COLUMN IF NOT EXISTS "aiModel" TEXT;
ALTER TABLE "DirectMessage" ADD COLUMN IF NOT EXISTS "aiReviewedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "DirectMessage_aiReviewStatus_hidden_aiReviewedAt_idx"
  ON "DirectMessage"("aiReviewStatus", "hidden", "aiReviewedAt");
