ALTER TABLE "UserVerificationApplication"
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'user_application';

CREATE INDEX IF NOT EXISTS "UserVerificationApplication_source_createdAt_idx"
  ON "UserVerificationApplication"("source", "createdAt");
