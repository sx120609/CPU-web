-- CreateTable
CREATE TABLE "ForumImageAsset" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "url" TEXT NOT NULL,
    "localPath" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "detail" TEXT,
    "reviewModel" TEXT,
    "reviewEndpoint" TEXT,
    "reviewedAt" DATETIME,
    "lastAttemptAt" DATETIME,
    "nextRetryAt" DATETIME,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ForumImageAsset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ForumImageAsset_url_key" ON "ForumImageAsset"("url");

-- CreateIndex
CREATE INDEX "ForumImageAsset_status_nextRetryAt_createdAt_idx" ON "ForumImageAsset"("status", "nextRetryAt", "createdAt");

-- CreateIndex
CREATE INDEX "ForumImageAsset_createdById_createdAt_idx" ON "ForumImageAsset"("createdById", "createdAt");
