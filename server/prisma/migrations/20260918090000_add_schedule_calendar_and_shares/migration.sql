CREATE TABLE IF NOT EXISTS "ScheduleTermConfig" (
    "id" SERIAL NOT NULL,
    "semester" TEXT NOT NULL,
    "semesterStartMonday" TEXT NOT NULL,
    "weekCount" INTEGER NOT NULL,
    "periods" TEXT NOT NULL,
    "adjustments" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "note" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScheduleTermConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ScheduleTermConfig_semester_key" ON "ScheduleTermConfig"("semester");
CREATE INDEX IF NOT EXISTS "ScheduleTermConfig_updatedAt_idx" ON "ScheduleTermConfig"("updatedAt");

CREATE TABLE IF NOT EXISTS "ScheduleShare" (
    "code" TEXT NOT NULL,
    "writeTokenHash" TEXT NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "ownerName" TEXT NOT NULL,
    "semester" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "termSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "ScheduleShare_pkey" PRIMARY KEY ("code")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ScheduleShare_writeTokenHash_key" ON "ScheduleShare"("writeTokenHash");
CREATE INDEX IF NOT EXISTS "ScheduleShare_ownerId_updatedAt_idx" ON "ScheduleShare"("ownerId", "updatedAt");
CREATE INDEX IF NOT EXISTS "ScheduleShare_revokedAt_idx" ON "ScheduleShare"("revokedAt");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ScheduleShare_ownerId_fkey') THEN
    ALTER TABLE "ScheduleShare" ADD CONSTRAINT "ScheduleShare_ownerId_fkey"
      FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
