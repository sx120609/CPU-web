ALTER TABLE "LostFoundItem"
  ADD COLUMN "storageLocation" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "publisherDepartment" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "claimDeadline" TIMESTAMP(3),
  ADD COLUMN "remark" TEXT NOT NULL DEFAULT '';

UPDATE "LostFoundItem" SET "publishedAt" = "createdAt";
ALTER TABLE "LostFoundItem"
  ALTER COLUMN "publishedAt" SET NOT NULL,
  ALTER COLUMN "publishedAt" SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "LostFoundItem_publishedAt_idx" ON "LostFoundItem"("publishedAt");
CREATE INDEX "LostFoundItem_claimDeadline_idx" ON "LostFoundItem"("claimDeadline");
