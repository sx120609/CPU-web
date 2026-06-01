-- CreateTable
CREATE TABLE "AiReviewLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "targetId" INTEGER,
    "targetLabel" TEXT,
    "targetUrl" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "endpoint" TEXT,
    "status" TEXT NOT NULL DEFAULT 'started',
    "requestSummary" TEXT NOT NULL DEFAULT '',
    "responseSummary" TEXT NOT NULL DEFAULT '',
    "errorMessage" TEXT,
    "createdById" INTEGER,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiReviewLog_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AiReviewLog_kind_startedAt_idx" ON "AiReviewLog"("kind", "startedAt");

-- CreateIndex
CREATE INDEX "AiReviewLog_status_startedAt_idx" ON "AiReviewLog"("status", "startedAt");

-- CreateIndex
CREATE INDEX "AiReviewLog_targetId_kind_startedAt_idx" ON "AiReviewLog"("targetId", "kind", "startedAt");
