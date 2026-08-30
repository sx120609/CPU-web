CREATE TABLE IF NOT EXISTS "ForumReport" (
  "id" SERIAL NOT NULL,
  "reporterId" INTEGER NOT NULL,
  "targetAuthorId" INTEGER,
  "targetType" TEXT NOT NULL,
  "targetId" INTEGER NOT NULL,
  "targetLabel" TEXT NOT NULL,
  "contentSnapshot" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "detail" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "handledById" INTEGER,
  "handledNote" TEXT NOT NULL DEFAULT '',
  "handledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ForumReport_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Topic" ADD COLUMN IF NOT EXISTS "reportHiddenAt" TIMESTAMP(3);
ALTER TABLE "Reply" ADD COLUMN IF NOT EXISTS "reportHiddenAt" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ForumReport_reporterId_fkey') THEN
    ALTER TABLE "ForumReport" ADD CONSTRAINT "ForumReport_reporterId_fkey"
      FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ForumReport_targetAuthorId_fkey') THEN
    ALTER TABLE "ForumReport" ADD CONSTRAINT "ForumReport_targetAuthorId_fkey"
      FOREIGN KEY ("targetAuthorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ForumReport_handledById_fkey') THEN
    ALTER TABLE "ForumReport" ADD CONSTRAINT "ForumReport_handledById_fkey"
      FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ForumReport_reporterId_targetType_targetId_key"
  ON "ForumReport"("reporterId", "targetType", "targetId");
CREATE INDEX IF NOT EXISTS "ForumReport_status_createdAt_idx" ON "ForumReport"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "ForumReport_targetType_targetId_idx" ON "ForumReport"("targetType", "targetId");
CREATE INDEX IF NOT EXISTS "ForumReport_targetAuthorId_createdAt_idx" ON "ForumReport"("targetAuthorId", "createdAt");
CREATE INDEX IF NOT EXISTS "ForumReport_handledById_handledAt_idx" ON "ForumReport"("handledById", "handledAt");
