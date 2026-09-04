ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "verificationType" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "verificationLabel" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "verificationVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "verificationExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "verificationApplicationId" INTEGER;

CREATE TABLE IF NOT EXISTS "UserVerificationApplication" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "requestedLabel" TEXT NOT NULL,
  "identityDescription" TEXT NOT NULL,
  "evidence" TEXT NOT NULL,
  "contact" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "approvedLabel" TEXT,
  "reviewerId" INTEGER,
  "reviewNote" TEXT NOT NULL DEFAULT '',
  "reviewedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserVerificationApplication_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserVerificationApplication_userId_fkey') THEN
    ALTER TABLE "UserVerificationApplication" ADD CONSTRAINT "UserVerificationApplication_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserVerificationApplication_reviewerId_fkey') THEN
    ALTER TABLE "UserVerificationApplication" ADD CONSTRAINT "UserVerificationApplication_reviewerId_fkey"
      FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "User_verificationApplicationId_key" ON "User"("verificationApplicationId");
CREATE INDEX IF NOT EXISTS "UserVerificationApplication_userId_createdAt_idx" ON "UserVerificationApplication"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "UserVerificationApplication_status_createdAt_idx" ON "UserVerificationApplication"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "UserVerificationApplication_reviewerId_reviewedAt_idx" ON "UserVerificationApplication"("reviewerId", "reviewedAt");
