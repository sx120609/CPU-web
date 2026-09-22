ALTER TABLE "LiveActivityDevice"
  ADD COLUMN IF NOT EXISTS "installationId" TEXT,
  ADD COLUMN IF NOT EXISTS "accountScope" TEXT,
  ADD COLUMN IF NOT EXISTS "launchMode" TEXT NOT NULL DEFAULT 'remote',
  ADD COLUMN IF NOT EXISTS "modeRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "handoffId" TEXT,
  ADD COLUMN IF NOT EXISTS "handoffResult" TEXT,
  ADD COLUMN IF NOT EXISTS "planRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "planSnapshot" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "LiveActivityDevice_userId_installationId_key" ON "LiveActivityDevice"("userId", "installationId");
CREATE TABLE IF NOT EXISTS "LiveActivityScheduleVersion" (
  "id" TEXT PRIMARY KEY, "scheduleId" TEXT NOT NULL, "timezone" TEXT NOT NULL,
  "periods" TEXT NOT NULL, "broadcastUntil" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
UPDATE "LiveActivityPlan" SET "state" = 'cancelled', "detail" = 'retired protocol' WHERE "state" IN ('pending', 'claimed') AND "event" <> 'course-start-v2';
UPDATE "LiveActivityDevice" SET "enabled" = false WHERE "installationId" IS NULL;
UPDATE "LiveActivityBroadcastEvent" SET "state" = 'skipped' WHERE "state" = 'pending' AND "eventID" NOT LIKE 'v2-%';
