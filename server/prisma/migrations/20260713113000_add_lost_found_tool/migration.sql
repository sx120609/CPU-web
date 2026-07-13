-- CreateTable
CREATE TABLE "LostFoundItem" (
    "id" SERIAL NOT NULL,
    "topicId" INTEGER NOT NULL,
    "publisherId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "campus" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL,
    "happenedAt" TIMESTAMP(3) NOT NULL,
    "contact" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LostFoundItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LostFoundImage" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LostFoundImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LostFoundClaim" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "claimantId" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "evidence" TEXT NOT NULL DEFAULT '',
    "contact" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LostFoundClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LostFoundItem_topicId_key" ON "LostFoundItem"("topicId");
CREATE INDEX "LostFoundItem_status_pinned_createdAt_idx" ON "LostFoundItem"("status", "pinned", "createdAt");
CREATE INDEX "LostFoundItem_kind_status_happenedAt_idx" ON "LostFoundItem"("kind", "status", "happenedAt");
CREATE INDEX "LostFoundItem_campus_status_happenedAt_idx" ON "LostFoundItem"("campus", "status", "happenedAt");
CREATE INDEX "LostFoundItem_publisherId_updatedAt_idx" ON "LostFoundItem"("publisherId", "updatedAt");
CREATE INDEX "LostFoundImage_itemId_sort_idx" ON "LostFoundImage"("itemId", "sort");
CREATE UNIQUE INDEX "LostFoundClaim_itemId_claimantId_key" ON "LostFoundClaim"("itemId", "claimantId");
CREATE INDEX "LostFoundClaim_itemId_status_createdAt_idx" ON "LostFoundClaim"("itemId", "status", "createdAt");
CREATE INDEX "LostFoundClaim_claimantId_updatedAt_idx" ON "LostFoundClaim"("claimantId", "updatedAt");

-- AddForeignKey
ALTER TABLE "LostFoundItem" ADD CONSTRAINT "LostFoundItem_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LostFoundItem" ADD CONSTRAINT "LostFoundItem_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LostFoundImage" ADD CONSTRAINT "LostFoundImage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LostFoundItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LostFoundClaim" ADD CONSTRAINT "LostFoundClaim_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LostFoundItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LostFoundClaim" ADD CONSTRAINT "LostFoundClaim_claimantId_fkey" FOREIGN KEY ("claimantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
