CREATE TABLE "CampusAssistantDailyUsage" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "dateKey" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampusAssistantDailyUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CampusAssistantDailyUsage_userId_dateKey_key"
ON "CampusAssistantDailyUsage"("userId", "dateKey");

CREATE INDEX "CampusAssistantDailyUsage_dateKey_idx"
ON "CampusAssistantDailyUsage"("dateKey");

CREATE INDEX "CampusAssistantDailyUsage_userId_updatedAt_idx"
ON "CampusAssistantDailyUsage"("userId", "updatedAt");

ALTER TABLE "CampusAssistantDailyUsage"
ADD CONSTRAINT "CampusAssistantDailyUsage_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
