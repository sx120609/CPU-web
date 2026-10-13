CREATE TABLE "WorkshopPlacement" (
  "slot" TEXT NOT NULL PRIMARY KEY CHECK ("slot" IN ('splash', 'dialog')),
  "versionId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkshopPlacement_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "WorkshopVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WorkshopPlacement_versionId_idx" ON "WorkshopPlacement"("versionId");
