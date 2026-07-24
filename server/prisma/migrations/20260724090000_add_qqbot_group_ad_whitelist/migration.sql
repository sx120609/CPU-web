CREATE TABLE "QqBotGroupAdVerification" (
    "id" SERIAL NOT NULL,
    "groupId" TEXT NOT NULL,
    "qqId" TEXT NOT NULL,
    "nickname" TEXT,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QqBotGroupAdVerification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QqBotGroupAdWhitelist" (
    "id" SERIAL NOT NULL,
    "groupId" TEXT NOT NULL,
    "qqId" TEXT NOT NULL,
    "nickname" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QqBotGroupAdWhitelist_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QqBotGroupAdVerification_groupId_qqId_expiresAt_idx" ON "QqBotGroupAdVerification"("groupId", "qqId", "expiresAt");
CREATE INDEX "QqBotGroupAdVerification_qqId_codeHash_idx" ON "QqBotGroupAdVerification"("qqId", "codeHash");
CREATE INDEX "QqBotGroupAdVerification_qqId_expiresAt_idx" ON "QqBotGroupAdVerification"("qqId", "expiresAt");
CREATE UNIQUE INDEX "QqBotGroupAdWhitelist_groupId_qqId_key" ON "QqBotGroupAdWhitelist"("groupId", "qqId");
CREATE INDEX "QqBotGroupAdWhitelist_groupId_expiresAt_idx" ON "QqBotGroupAdWhitelist"("groupId", "expiresAt");
CREATE INDEX "QqBotGroupAdWhitelist_qqId_expiresAt_idx" ON "QqBotGroupAdWhitelist"("qqId", "expiresAt");
