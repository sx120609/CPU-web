ALTER TABLE "QqBotGroup"
ADD COLUMN "adFilterReportThreshold" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "QqBotGroupAdReport" (
    "id" SERIAL NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "groupName" TEXT,
    "offenderQqId" TEXT NOT NULL,
    "offenderNickname" TEXT,
    "reason" TEXT NOT NULL,
    "hitCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reportMessageId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "handledAt" TIMESTAMP(3),
    "handledByQqId" TEXT,
    "handledAction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QqBotGroupAdReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QqBotGroupAdReport_tokenHash_key" ON "QqBotGroupAdReport"("tokenHash");
CREATE INDEX "QqBotGroupAdReport_groupId_status_createdAt_idx" ON "QqBotGroupAdReport"("groupId", "status", "createdAt");
CREATE INDEX "QqBotGroupAdReport_groupId_offenderQqId_status_idx" ON "QqBotGroupAdReport"("groupId", "offenderQqId", "status");
