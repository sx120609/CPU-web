-- CreateTable
CREATE TABLE "ScheduleWidgetToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "name" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenSuffix" TEXT NOT NULL,
    "jwxtToken" TEXT NOT NULL,
    "lastUsedAt" DATETIME,
    "expiresAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScheduleWidgetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleWidgetToken_tokenHash_key" ON "ScheduleWidgetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ScheduleWidgetToken_userId_revokedAt_idx" ON "ScheduleWidgetToken"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "ScheduleWidgetToken_lastUsedAt_idx" ON "ScheduleWidgetToken"("lastUsedAt");
