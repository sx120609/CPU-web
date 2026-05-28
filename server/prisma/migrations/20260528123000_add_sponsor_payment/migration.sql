ALTER TABLE "User" ADD COLUMN "sponsorTotalCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "EpayConfig" ADD COLUMN "enabledTypes" TEXT NOT NULL DEFAULT '["alipay","wxpay"]';

CREATE TABLE "SponsorOrder" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" INTEGER NOT NULL,
  "outTradeNo" TEXT NOT NULL,
  "tradeNo" TEXT,
  "payType" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "paidAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SponsorOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SponsorOrder_outTradeNo_key" ON "SponsorOrder"("outTradeNo");
CREATE INDEX "SponsorOrder_userId_status_idx" ON "SponsorOrder"("userId", "status");
CREATE INDEX "SponsorOrder_status_createdAt_idx" ON "SponsorOrder"("status", "createdAt");
