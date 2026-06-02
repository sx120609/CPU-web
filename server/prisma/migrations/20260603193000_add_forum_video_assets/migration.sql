CREATE TABLE "ForumVideoAsset" (
  "id" SERIAL NOT NULL,
  "url" TEXT NOT NULL,
  "localPath" TEXT NOT NULL,
  "mimeType" TEXT,
  "fileSize" INTEGER,
  "durationMs" INTEGER,
  "width" INTEGER,
  "height" INTEGER,
  "hasAudio" BOOLEAN NOT NULL DEFAULT false,
  "transcript" TEXT,
  "transcriptStatus" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reason" TEXT,
  "detail" TEXT,
  "reviewModel" TEXT,
  "reviewEndpoint" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "nextRetryAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdById" INTEGER,
  "manualReviewedById" INTEGER,
  "manualReviewedAt" TIMESTAMP(3),
  "manualReviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ForumVideoAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ForumVideoAsset_url_key" ON "ForumVideoAsset"("url");
CREATE INDEX "ForumVideoAsset_status_nextRetryAt_createdAt_idx" ON "ForumVideoAsset"("status", "nextRetryAt", "createdAt");
CREATE INDEX "ForumVideoAsset_createdById_createdAt_idx" ON "ForumVideoAsset"("createdById", "createdAt");

ALTER TABLE "ForumVideoAsset"
ADD CONSTRAINT "ForumVideoAsset_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ForumVideoAsset"
ADD CONSTRAINT "ForumVideoAsset_manualReviewedById_fkey"
FOREIGN KEY ("manualReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
