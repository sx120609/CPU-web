ALTER TABLE "LiveActivityPlan"
  ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "claimedUntil" TIMESTAMP(3);

ALTER TABLE "LiveActivityBroadcastEvent"
  ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "claimedUntil" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "LiveActivityPlan_state_fireAt_nextAttemptAt_idx"
  ON "LiveActivityPlan"("state", "fireAt", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "LiveActivityBroadcastEvent_state_fireAt_nextAttemptAt_idx"
  ON "LiveActivityBroadcastEvent"("state", "fireAt", "nextAttemptAt");

DROP INDEX IF EXISTS "LiveActivityPlan_state_fireAt_idx";
DROP INDEX IF EXISTS "LiveActivityBroadcastEvent_state_fireAt_idx";
