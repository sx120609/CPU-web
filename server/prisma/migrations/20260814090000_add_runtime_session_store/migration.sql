CREATE TABLE "RuntimeSession" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RuntimeSession_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "RuntimeSession_expiresAt_idx" ON "RuntimeSession"("expiresAt");
