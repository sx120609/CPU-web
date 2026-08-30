ALTER TABLE "DirectConversation"
ADD COLUMN "scopeKey" TEXT NOT NULL DEFAULT 'direct',
ADD COLUMN "participantLowAlias" TEXT,
ADD COLUMN "participantHighAlias" TEXT;

ALTER TABLE "DirectConversation"
DROP CONSTRAINT IF EXISTS "DirectConversation_participantLowId_participantHighId_key";

DROP INDEX IF EXISTS "DirectConversation_participantLowId_participantHighId_key";

CREATE UNIQUE INDEX "DirectConversation_participantLowId_participantHighId_scopeKey_key"
ON "DirectConversation"("participantLowId", "participantHighId", "scopeKey");
