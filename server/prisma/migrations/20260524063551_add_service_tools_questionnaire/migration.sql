-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Topic" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "boardId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "aiReviewStatus" TEXT NOT NULL DEFAULT 'none',
    "aiRiskLevel" TEXT,
    "aiRiskScore" INTEGER,
    "aiReviewReason" TEXT,
    "aiReviewDetail" TEXT,
    "aiModel" TEXT,
    "aiReviewedAt" DATETIME,
    "manualReviewedById" INTEGER,
    "manualReviewedAt" DATETIME,
    "manualReviewNote" TEXT,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "anonymousAlias" TEXT,
    "editCount" INTEGER NOT NULL DEFAULT 0,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "lastReplyAt" DATETIME,
    "lastReplyById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Topic_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Topic_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Topic_manualReviewedById_fkey" FOREIGN KEY ("manualReviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Topic" ("aiModel", "aiReviewDetail", "aiReviewReason", "aiReviewStatus", "aiReviewedAt", "aiRiskLevel", "aiRiskScore", "anonymousAlias", "authorId", "boardId", "content", "createdAt", "editCount", "hidden", "id", "isAnonymous", "lastReplyAt", "lastReplyById", "likeCount", "locked", "manualReviewNote", "manualReviewedAt", "manualReviewedById", "metadata", "pinned", "replyCount", "title", "updatedAt", "viewCount") SELECT "aiModel", "aiReviewDetail", "aiReviewReason", "aiReviewStatus", "aiReviewedAt", "aiRiskLevel", "aiRiskScore", "anonymousAlias", "authorId", "boardId", "content", "createdAt", "editCount", "hidden", "id", "isAnonymous", "lastReplyAt", "lastReplyById", "likeCount", "locked", "manualReviewNote", "manualReviewedAt", "manualReviewedById", "metadata", "pinned", "replyCount", "title", "updatedAt", "viewCount" FROM "Topic";
DROP TABLE "Topic";
ALTER TABLE "new_Topic" RENAME TO "Topic";
CREATE INDEX "Topic_boardId_lastReplyAt_idx" ON "Topic"("boardId", "lastReplyAt");
CREATE INDEX "Topic_authorId_idx" ON "Topic"("authorId");
CREATE INDEX "Topic_authorId_aiReviewStatus_idx" ON "Topic"("authorId", "aiReviewStatus");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
