-- CreateTable
CREATE TABLE "QqBotConversation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "qqId" TEXT NOT NULL,
    "groupId" TEXT,
    "scene" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "step" TEXT NOT NULL,
    "draftTitle" TEXT,
    "draftContent" TEXT NOT NULL DEFAULT '',
    "draftBoardSlug" TEXT,
    "sourceMessageId" TEXT,
    "sourceSummary" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "QqBotConversation_qqId_status_updatedAt_idx" ON "QqBotConversation"("qqId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "QqBotConversation_groupId_status_updatedAt_idx" ON "QqBotConversation"("groupId", "status", "updatedAt");
