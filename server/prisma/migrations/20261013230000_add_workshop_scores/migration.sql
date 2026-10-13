-- Workshop leaderboards: one best score per player and work.
CREATE TABLE "WorkshopScore" (
    "workId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "achievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkshopScore_pkey" PRIMARY KEY ("workId","userId")
);

CREATE INDEX "WorkshopScore_workId_score_achievedAt_idx" ON "WorkshopScore"("workId", "score", "achievedAt");
CREATE INDEX "WorkshopScore_userId_idx" ON "WorkshopScore"("userId");

ALTER TABLE "WorkshopScore" ADD CONSTRAINT "WorkshopScore_workId_fkey" FOREIGN KEY ("workId") REFERENCES "WorkshopWork"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkshopScore" ADD CONSTRAINT "WorkshopScore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
