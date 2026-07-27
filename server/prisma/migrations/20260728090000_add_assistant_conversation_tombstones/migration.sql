ALTER TABLE "CampusAssistantConversation"
ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "CampusAssistantConversation_userId_deletedAt_idx"
ON "CampusAssistantConversation"("userId", "deletedAt");
