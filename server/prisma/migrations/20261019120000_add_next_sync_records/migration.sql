-- 药大拾间 NEXT cross-device sync: agenda items, 拾间AI conversations and the action log.
CREATE TABLE "NextSyncRecord" (
    "userId" INTEGER NOT NULL,
    "collection" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '',
    "clientUpdatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NextSyncRecord_pkey" PRIMARY KEY ("userId", "collection", "id")
);

CREATE INDEX "NextSyncRecord_userId_updatedAt_idx" ON "NextSyncRecord"("userId", "updatedAt");
CREATE INDEX "NextSyncRecord_userId_collection_deletedAt_clientUpdatedAt_idx" ON "NextSyncRecord"("userId", "collection", "deletedAt", "clientUpdatedAt");

ALTER TABLE "NextSyncRecord" ADD CONSTRAINT "NextSyncRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
