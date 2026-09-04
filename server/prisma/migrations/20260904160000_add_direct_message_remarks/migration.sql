CREATE TABLE IF NOT EXISTS "DirectMessageRemark" (
  "id" SERIAL NOT NULL,
  "ownerId" INTEGER NOT NULL,
  "targetUserId" INTEGER NOT NULL,
  "remark" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DirectMessageRemark_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DirectMessageRemark_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DirectMessageRemark_targetUserId_fkey"
    FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "DirectMessageRemark_ownerId_targetUserId_key"
  ON "DirectMessageRemark"("ownerId", "targetUserId");

CREATE INDEX IF NOT EXISTS "DirectMessageRemark_targetUserId_idx"
  ON "DirectMessageRemark"("targetUserId");
