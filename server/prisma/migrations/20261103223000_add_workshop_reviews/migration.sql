-- Public per-subject reviews for workshop works that declare `reviews`.
CREATE TABLE "WorkshopReview" (
    "id" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkshopReview_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkshopReview_rating_check" CHECK ("rating" BETWEEN 1 AND 5)
);

CREATE UNIQUE INDEX "WorkshopReview_workId_userId_subject_key" ON "WorkshopReview"("workId", "userId", "subject");
CREATE INDEX "WorkshopReview_workId_subject_updatedAt_idx" ON "WorkshopReview"("workId", "subject", "updatedAt");
CREATE INDEX "WorkshopReview_userId_updatedAt_idx" ON "WorkshopReview"("userId", "updatedAt");

ALTER TABLE "WorkshopReview" ADD CONSTRAINT "WorkshopReview_workId_fkey" FOREIGN KEY ("workId") REFERENCES "WorkshopWork"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkshopReview" ADD CONSTRAINT "WorkshopReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
