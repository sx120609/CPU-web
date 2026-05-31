-- CreateTable
CREATE TABLE "QqBotConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "napcatBaseUrl" TEXT NOT NULL DEFAULT '',
    "accessToken" TEXT NOT NULL DEFAULT '',
    "webhookSecret" TEXT NOT NULL DEFAULT '',
    "defaultBoardSlug" TEXT NOT NULL DEFAULT 'general',
    "allowPrivatePost" BOOLEAN NOT NULL DEFAULT true,
    "allowGroupPost" BOOLEAN NOT NULL DEFAULT false,
    "notificationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyCategories" TEXT NOT NULL DEFAULT '["reply","mention","like","system"]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "QqBotBinding" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "qqId" TEXT NOT NULL,
    "nickname" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QqBotBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QqBotBindToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "usedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QqBotBindToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QqBotGroup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "groupId" TEXT NOT NULL,
    "name" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowPosting" BOOLEAN NOT NULL DEFAULT false,
    "defaultBoardSlug" TEXT,
    "notificationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "QqBotMessageLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "direction" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "qqId" TEXT,
    "groupId" TEXT,
    "messageId" TEXT,
    "userId" INTEGER,
    "topicId" INTEGER,
    "notificationId" INTEGER,
    "command" TEXT,
    "content" TEXT NOT NULL DEFAULT '',
    "result" TEXT NOT NULL DEFAULT '',
    "rawPayload" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QqBotMessageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "QqBotBinding_qqId_key" ON "QqBotBinding"("qqId");

-- CreateIndex
CREATE INDEX "QqBotBinding_userId_idx" ON "QqBotBinding"("userId");

-- CreateIndex
CREATE INDEX "QqBotBinding_enabled_idx" ON "QqBotBinding"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "QqBotBindToken_token_key" ON "QqBotBindToken"("token");

-- CreateIndex
CREATE INDEX "QqBotBindToken_userId_expiresAt_idx" ON "QqBotBindToken"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "QqBotGroup_groupId_key" ON "QqBotGroup"("groupId");

-- CreateIndex
CREATE INDEX "QqBotGroup_enabled_idx" ON "QqBotGroup"("enabled");

-- CreateIndex
CREATE INDEX "QqBotMessageLog_eventType_createdAt_idx" ON "QqBotMessageLog"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "QqBotMessageLog_qqId_createdAt_idx" ON "QqBotMessageLog"("qqId", "createdAt");

-- CreateIndex
CREATE INDEX "QqBotMessageLog_userId_createdAt_idx" ON "QqBotMessageLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "QqBotMessageLog_notificationId_userId_idx" ON "QqBotMessageLog"("notificationId", "userId");
