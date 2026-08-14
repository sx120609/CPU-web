CREATE TABLE "ForumAd" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "linkUrl" TEXT NOT NULL,
    "buttonText" TEXT,
    "placement" TEXT NOT NULL DEFAULT 'forum-index-top',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "vipExempt" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ForumAd_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ForumAd_placement_enabled_sortOrder_idx" ON "ForumAd"("placement", "enabled", "sortOrder");
CREATE INDEX "ForumAd_startsAt_endsAt_idx" ON "ForumAd"("startsAt", "endsAt");
