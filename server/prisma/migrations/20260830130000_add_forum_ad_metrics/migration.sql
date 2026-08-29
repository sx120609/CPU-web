CREATE TABLE "ForumAdMetric" (
    "id" SERIAL NOT NULL,
    "adId" INTEGER NOT NULL,
    "day" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "placement" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ForumAdMetric_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ForumAdMetric_adId_day_device_placement_key" ON "ForumAdMetric"("adId", "day", "device", "placement");
CREATE INDEX "ForumAdMetric_day_idx" ON "ForumAdMetric"("day");
CREATE INDEX "ForumAdMetric_placement_day_idx" ON "ForumAdMetric"("placement", "day");

ALTER TABLE "ForumAdMetric" ADD CONSTRAINT "ForumAdMetric_adId_fkey" FOREIGN KEY ("adId") REFERENCES "ForumAd"("id") ON DELETE CASCADE ON UPDATE CASCADE;
