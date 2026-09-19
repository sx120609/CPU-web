ALTER TABLE "LiveActivityPlan"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "claimedUntil" TIMESTAMP(3);

ALTER TABLE "LiveActivityBroadcastEvent"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "claimedUntil" TIMESTAMP(3);

CREATE INDEX "LiveActivityPlan_state_fireAt_nextAttemptAt_idx"
  ON "LiveActivityPlan"("state", "fireAt", "nextAttemptAt");
CREATE INDEX "LiveActivityBroadcastEvent_state_fireAt_nextAttemptAt_idx"
  ON "LiveActivityBroadcastEvent"("state", "fireAt", "nextAttemptAt");

DROP INDEX IF EXISTS "LiveActivityPlan_state_fireAt_idx";
DROP INDEX IF EXISTS "LiveActivityBroadcastEvent_state_fireAt_idx";
