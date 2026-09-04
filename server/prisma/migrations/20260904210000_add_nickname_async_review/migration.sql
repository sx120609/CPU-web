ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "pendingNickname" TEXT,
  ADD COLUMN IF NOT EXISTS "nicknameReviewStatus" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "nicknameReviewReason" TEXT,
  ADD COLUMN IF NOT EXISTS "nicknameReviewDetail" TEXT,
  ADD COLUMN IF NOT EXISTS "nicknameReviewModel" TEXT,
  ADD COLUMN IF NOT EXISTS "nicknameReviewRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "nicknameReviewedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "User_nicknameReviewStatus_nicknameReviewedAt_idx"
  ON "User"("nicknameReviewStatus", "nicknameReviewedAt");
