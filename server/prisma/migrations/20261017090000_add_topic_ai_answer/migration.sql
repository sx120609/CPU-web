-- 拾间AI forum reference answers: one row per question topic.
CREATE TABLE "TopicAiAnswer" (
    "id" SERIAL NOT NULL,
    "topicId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "answer" TEXT NOT NULL DEFAULT '',
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "sources" TEXT NOT NULL DEFAULT '[]',
    "reason" TEXT NOT NULL DEFAULT '',
    "model" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "dismissedById" INTEGER,
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicAiAnswer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TopicAiAnswer_topicId_key" ON "TopicAiAnswer"("topicId");
CREATE INDEX "TopicAiAnswer_status_updatedAt_idx" ON "TopicAiAnswer"("status", "updatedAt");

ALTER TABLE "TopicAiAnswer" ADD CONSTRAINT "TopicAiAnswer_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
