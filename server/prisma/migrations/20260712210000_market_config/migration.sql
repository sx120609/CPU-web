-- Persist the singleton marketplace commission configuration for deployments
-- that execute SQL migrations instead of Prisma db push.
CREATE TABLE "MarketConfig" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "commissionBps" INTEGER NOT NULL DEFAULT 500,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketConfig_pkey" PRIMARY KEY ("id")
);

INSERT INTO "MarketConfig" ("id", "commissionBps", "createdAt", "updatedAt")
VALUES (1, 500, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
