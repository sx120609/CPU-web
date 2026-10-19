CREATE TABLE IF NOT EXISTS "YaodaMinesAttempt" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "score" INTEGER,
  "boards" INTEGER,
  "cells" INTEGER,
  "durationMs" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'active',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "YaodaMinesAttempt_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'YaodaMinesAttempt_userId_fkey') THEN
    ALTER TABLE "YaodaMinesAttempt" ADD CONSTRAINT "YaodaMinesAttempt_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "YaodaMinesAttempt_userId_score_idx" ON "YaodaMinesAttempt"("userId", "score");
CREATE INDEX IF NOT EXISTS "YaodaMinesAttempt_status_completedAt_idx" ON "YaodaMinesAttempt"("status", "completedAt");
CREATE INDEX IF NOT EXISTS "YaodaMinesAttempt_userId_startedAt_idx" ON "YaodaMinesAttempt"("userId", "startedAt");

CREATE TABLE IF NOT EXISTS "YaodaMinesAchievement" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "code" TEXT NOT NULL,
  "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "YaodaMinesAchievement_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'YaodaMinesAchievement_userId_fkey') THEN
    ALTER TABLE "YaodaMinesAchievement" ADD CONSTRAINT "YaodaMinesAchievement_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "YaodaMinesAchievement_userId_code_key" ON "YaodaMinesAchievement"("userId", "code");
CREATE INDEX IF NOT EXISTS "YaodaMinesAchievement_userId_unlockedAt_idx" ON "YaodaMinesAchievement"("userId", "unlockedAt");
CREATE INDEX IF NOT EXISTS "YaodaMinesAchievement_code_unlockedAt_idx" ON "YaodaMinesAchievement"("code", "unlockedAt");
