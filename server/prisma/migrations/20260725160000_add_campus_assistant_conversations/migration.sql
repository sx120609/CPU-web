CREATE TABLE "CampusAssistantConversation" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "messages" TEXT NOT NULL,
    "clientUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampusAssistantConversation_pkey" PRIMARY KEY ("userId", "id")
);

CREATE INDEX "CampusAssistantConversation_userId_clientUpdatedAt_idx"
ON "CampusAssistantConversation"("userId", "clientUpdatedAt");

ALTER TABLE "CampusAssistantConversation"
ADD CONSTRAINT "CampusAssistantConversation_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
