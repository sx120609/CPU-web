DO $migration$
BEGIN
  IF to_regclass('"DirectConversation"') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE "DirectConversation"
    ADD COLUMN IF NOT EXISTS "scopeKey" TEXT,
    ADD COLUMN IF NOT EXISTS "participantLowAlias" TEXT,
    ADD COLUMN IF NOT EXISTS "participantHighAlias" TEXT;

  UPDATE "DirectConversation"
  SET "scopeKey" = 'direct'
  WHERE "scopeKey" IS NULL OR btrim("scopeKey") = '';

  WITH grouped AS (
    SELECT
      "participantLowId",
      "participantHighId",
      "scopeKey",
      MIN("id") AS "keeperId",
      MIN("createdAt") AS "firstCreatedAt",
      MAX("updatedAt") AS "lastUpdatedAt",
      MAX("lastMessageAt") AS "lastMessageAt",
      MIN("recipientRepliedAt") FILTER (WHERE "recipientRepliedAt" IS NOT NULL) AS "recipientRepliedAt",
      MAX("participantLowAlias") FILTER (WHERE "participantLowAlias" IS NOT NULL) AS "participantLowAlias",
      MAX("participantHighAlias") FILTER (WHERE "participantHighAlias" IS NOT NULL) AS "participantHighAlias"
    FROM "DirectConversation"
    GROUP BY "participantLowId", "participantHighId", "scopeKey"
    HAVING COUNT(*) > 1
  )
  UPDATE "DirectConversation" AS keeper
  SET
    "createdAt" = grouped."firstCreatedAt",
    "updatedAt" = grouped."lastUpdatedAt",
    "lastMessageAt" = grouped."lastMessageAt",
    "recipientRepliedAt" = grouped."recipientRepliedAt",
    "participantLowAlias" = COALESCE(keeper."participantLowAlias", grouped."participantLowAlias"),
    "participantHighAlias" = COALESCE(keeper."participantHighAlias", grouped."participantHighAlias")
  FROM grouped
  WHERE keeper."id" = grouped."keeperId";

  WITH ranked AS (
    SELECT
      "id",
      MIN("id") OVER (
        PARTITION BY "participantLowId", "participantHighId", "scopeKey"
      ) AS "keeperId"
    FROM "DirectConversation"
  )
  UPDATE "DirectMessage" AS message
  SET "conversationId" = ranked."keeperId"
  FROM ranked
  WHERE message."conversationId" = ranked."id"
    AND ranked."id" <> ranked."keeperId";

  WITH ranked AS (
    SELECT
      "id",
      MIN("id") OVER (
        PARTITION BY "participantLowId", "participantHighId", "scopeKey"
      ) AS "keeperId"
    FROM "DirectConversation"
  )
  DELETE FROM "DirectConversation" AS duplicate
  USING ranked
  WHERE duplicate."id" = ranked."id"
    AND ranked."id" <> ranked."keeperId";

  ALTER TABLE "DirectConversation"
    ALTER COLUMN "scopeKey" SET DEFAULT 'direct',
    ALTER COLUMN "scopeKey" SET NOT NULL,
    DROP CONSTRAINT IF EXISTS "DirectConversation_participantLowId_participantHighId_key";

  DROP INDEX IF EXISTS "DirectConversation_participantLowId_participantHighId_key";

  CREATE UNIQUE INDEX IF NOT EXISTS "DirectConversation_participantLowId_participantHighId_scopeKey_key"
  ON "DirectConversation"("participantLowId", "participantHighId", "scopeKey");
END
$migration$;
