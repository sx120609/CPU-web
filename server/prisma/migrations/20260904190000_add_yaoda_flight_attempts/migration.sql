CREATE TABLE IF NOT EXISTS "YaodaFlightAttempt" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "score" INTEGER,
  "durationMs" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'active',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "YaodaFlightAttempt_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'YaodaFlightAttempt_userId_fkey') THEN
    ALTER TABLE "YaodaFlightAttempt" ADD CONSTRAINT "YaodaFlightAttempt_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "YaodaFlightAttempt_userId_score_idx" ON "YaodaFlightAttempt"("userId", "score");
CREATE INDEX IF NOT EXISTS "YaodaFlightAttempt_status_completedAt_idx" ON "YaodaFlightAttempt"("status", "completedAt");
CREATE INDEX IF NOT EXISTS "YaodaFlightAttempt_userId_startedAt_idx" ON "YaodaFlightAttempt"("userId", "startedAt");

CREATE TABLE IF NOT EXISTS "YaodaFlightAchievement" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "code" TEXT NOT NULL,
  "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "YaodaFlightAchievement_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'YaodaFlightAchievement_userId_fkey') THEN
    ALTER TABLE "YaodaFlightAchievement" ADD CONSTRAINT "YaodaFlightAchievement_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "YaodaFlightAchievement_userId_code_key" ON "YaodaFlightAchievement"("userId", "code");
CREATE INDEX IF NOT EXISTS "YaodaFlightAchievement_userId_unlockedAt_idx" ON "YaodaFlightAchievement"("userId", "unlockedAt");
CREATE INDEX IF NOT EXISTS "YaodaFlightAchievement_code_unlockedAt_idx" ON "YaodaFlightAchievement"("code", "unlockedAt");
