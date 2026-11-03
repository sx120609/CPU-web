-- Public per-shop ratings and comments for the native canteen picker.
CREATE TABLE "CanteenReview" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "shopId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanteenReview_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CanteenReview_rating_check" CHECK ("rating" BETWEEN 1 AND 5)
);

CREATE UNIQUE INDEX "CanteenReview_userId_shopId_key" ON "CanteenReview"("userId", "shopId");
CREATE INDEX "CanteenReview_shopId_updatedAt_idx" ON "CanteenReview"("shopId", "updatedAt");
CREATE INDEX "CanteenReview_userId_updatedAt_idx" ON "CanteenReview"("userId", "updatedAt");

ALTER TABLE "CanteenReview" ADD CONSTRAINT "CanteenReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
