PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ForumImageAsset" (
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
    "manualReviewedById" INTEGER,
    "manualReviewedAt" DATETIME,
    "manualReviewNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ForumImageAsset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ForumImageAsset_manualReviewedById_fkey" FOREIGN KEY ("manualReviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ForumImageAsset" (
    "id",
    "url",
    "localPath",
    "mimeType",
    "fileSize",
    "status",
    "reason",
    "detail",
    "reviewModel",
    "reviewEndpoint",
    "reviewedAt",
    "lastAttemptAt",
    "nextRetryAt",
    "attemptCount",
    "lastError",
    "createdById",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "url",
    "localPath",
    "mimeType",
    "fileSize",
    "status",
    "reason",
    "detail",
    "reviewModel",
    "reviewEndpoint",
    "reviewedAt",
    "lastAttemptAt",
    "nextRetryAt",
    "attemptCount",
    "lastError",
    "createdById",
    "createdAt",
    "updatedAt"
FROM "ForumImageAsset";
DROP TABLE "ForumImageAsset";
ALTER TABLE "new_ForumImageAsset" RENAME TO "ForumImageAsset";
CREATE UNIQUE INDEX "ForumImageAsset_url_key" ON "ForumImageAsset"("url");
CREATE INDEX "ForumImageAsset_status_nextRetryAt_createdAt_idx" ON "ForumImageAsset"("status", "nextRetryAt", "createdAt");
CREATE INDEX "ForumImageAsset_createdById_createdAt_idx" ON "ForumImageAsset"("createdById", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
