ALTER TABLE "SponsorOrder" ADD COLUMN "message" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SponsorOrder" ADD COLUMN "displayMode" TEXT NOT NULL DEFAULT 'public';
ALTER TABLE "SponsorOrder" ADD COLUMN "closedAt" DATETIME;

CREATE TABLE "SponsorPaymentLog" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "orderId" INTEGER,
  "outTradeNo" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'epay',
  "event" TEXT NOT NULL DEFAULT 'notify',
  "rawPayload" TEXT NOT NULL DEFAULT '{}',
  "signOk" BOOLEAN NOT NULL DEFAULT false,
  "handled" BOOLEAN NOT NULL DEFAULT false,
  "result" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SponsorPaymentLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SponsorOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "SponsorPaymentLog_outTradeNo_idx" ON "SponsorPaymentLog"("outTradeNo");
CREATE INDEX "SponsorPaymentLog_createdAt_idx" ON "SponsorPaymentLog"("createdAt");
