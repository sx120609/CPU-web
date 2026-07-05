CREATE TABLE "QqBotGroupAdStrike" (
    "id" SERIAL NOT NULL,
    "groupId" TEXT NOT NULL,
    "qqId" TEXT NOT NULL,
    "nickname" TEXT,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "lastReason" TEXT,
    "lastRiskScore" INTEGER,
    "lastModel" TEXT,
    "lastHitAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QqBotGroupAdStrike_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QqBotGroupAdStrike_groupId_qqId_key" ON "QqBotGroupAdStrike"("groupId", "qqId");
CREATE INDEX "QqBotGroupAdStrike_groupId_lastHitAt_idx" ON "QqBotGroupAdStrike"("groupId", "lastHitAt");
CREATE INDEX "QqBotGroupAdStrike_qqId_lastHitAt_idx" ON "QqBotGroupAdStrike"("qqId", "lastHitAt");
