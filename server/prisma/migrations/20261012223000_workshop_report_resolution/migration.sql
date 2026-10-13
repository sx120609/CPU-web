ALTER TABLE "WorkshopReport"
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "resolution" TEXT,
  ADD COLUMN "resolvedById" INTEGER;

CREATE INDEX "WorkshopReport_resolvedAt_createdAt_idx" ON "WorkshopReport"("resolvedAt", "createdAt");

ALTER TABLE "WorkshopReport" ADD CONSTRAINT "WorkshopReport_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
