ALTER TABLE "User"
  ADD COLUMN "vipLevel" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "vipExpiresAt" TIMESTAMP(3),
  ADD COLUMN "profileTheme" TEXT,
  ADD COLUMN "profileFrame" TEXT;

CREATE TABLE "ForumReaction" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "topicId" INTEGER,
  "replyId" INTEGER,
  "kind" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ForumReaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ForumReaction_userId_topicId_kind_key" ON "ForumReaction"("userId", "topicId", "kind");
CREATE UNIQUE INDEX "ForumReaction_userId_replyId_kind_key" ON "ForumReaction"("userId", "replyId", "kind");
CREATE INDEX "ForumReaction_topicId_kind_idx" ON "ForumReaction"("topicId", "kind");
CREATE INDEX "ForumReaction_replyId_kind_idx" ON "ForumReaction"("replyId", "kind");

ALTER TABLE "ForumReaction"
  ADD CONSTRAINT "ForumReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ForumReaction_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ForumReaction_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "Reply"("id") ON DELETE CASCADE ON UPDATE CASCADE;
