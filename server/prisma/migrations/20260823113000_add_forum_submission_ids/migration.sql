ALTER TABLE "Topic" ADD COLUMN "submissionId" TEXT;
ALTER TABLE "Reply" ADD COLUMN "submissionId" TEXT;

CREATE UNIQUE INDEX "Topic_authorId_submissionId_key" ON "Topic"("authorId", "submissionId");
CREATE UNIQUE INDEX "Reply_authorId_submissionId_key" ON "Reply"("authorId", "submissionId");
