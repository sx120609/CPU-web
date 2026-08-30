ALTER TABLE "SponsorOrder"
  ADD COLUMN "categoryId" TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN "categoryTitle" TEXT NOT NULL DEFAULT '支持药大拾间';

CREATE INDEX "SponsorOrder_categoryId_status_paidAt_idx"
  ON "SponsorOrder"("categoryId", "status", "paidAt");
