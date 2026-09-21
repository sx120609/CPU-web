-- CreateTable
CREATE TABLE IF NOT EXISTS "LiveActivityRegistration" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenCiphertext" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "bundleID" TEXT NOT NULL,
    "attributes" TEXT NOT NULL,
    "contentState" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastPushedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveActivityRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiveActivityRegistration_tokenHash_key" ON "LiveActivityRegistration"("tokenHash");
CREATE INDEX IF NOT EXISTS "LiveActivityRegistration_userId_active_idx" ON "LiveActivityRegistration"("userId", "active");
CREATE INDEX IF NOT EXISTS "LiveActivityRegistration_active_updatedAt_idx" ON "LiveActivityRegistration"("active", "updatedAt");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'LiveActivityRegistration_userId_fkey' AND conrelid = '"LiveActivityRegistration"'::regclass
  ) THEN
    ALTER TABLE "LiveActivityRegistration" ADD CONSTRAINT "LiveActivityRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
