CREATE TABLE "VipGiftCode" (
    "id" SERIAL NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codePreview" TEXT NOT NULL,
    "vipLevel" INTEGER NOT NULL DEFAULT 1,
    "durationDays" INTEGER NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "note" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VipGiftCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VipGiftCodeRedemption" (
    "id" SERIAL NOT NULL,
    "giftCodeId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "vipLevel" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VipGiftCodeRedemption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VipGiftCode_codeHash_key" ON "VipGiftCode"("codeHash");
CREATE INDEX "VipGiftCode_enabled_startsAt_expiresAt_idx" ON "VipGiftCode"("enabled", "startsAt", "expiresAt");
CREATE INDEX "VipGiftCode_createdAt_idx" ON "VipGiftCode"("createdAt");
CREATE UNIQUE INDEX "VipGiftCodeRedemption_giftCodeId_userId_key" ON "VipGiftCodeRedemption"("giftCodeId", "userId");
CREATE INDEX "VipGiftCodeRedemption_userId_redeemedAt_idx" ON "VipGiftCodeRedemption"("userId", "redeemedAt");

ALTER TABLE "VipGiftCode" ADD CONSTRAINT "VipGiftCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VipGiftCodeRedemption" ADD CONSTRAINT "VipGiftCodeRedemption_giftCodeId_fkey" FOREIGN KEY ("giftCodeId") REFERENCES "VipGiftCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VipGiftCodeRedemption" ADD CONSTRAINT "VipGiftCodeRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
