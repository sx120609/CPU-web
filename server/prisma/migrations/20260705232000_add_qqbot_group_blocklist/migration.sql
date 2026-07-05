-- CreateTable
CREATE TABLE "QqBotGroupBlockedUser" (
    "id" SERIAL NOT NULL,
    "groupId" TEXT NOT NULL,
    "qqId" TEXT NOT NULL,
    "nickname" TEXT,
    "blockedByQqId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QqBotGroupBlockedUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QqBotGroupBlockedUser_groupId_qqId_key" ON "QqBotGroupBlockedUser"("groupId", "qqId");

-- CreateIndex
CREATE INDEX "QqBotGroupBlockedUser_groupId_createdAt_idx" ON "QqBotGroupBlockedUser"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "QqBotGroupBlockedUser_qqId_createdAt_idx" ON "QqBotGroupBlockedUser"("qqId", "createdAt");
