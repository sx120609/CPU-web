ALTER TABLE "MessageSetting" ADD COLUMN "qqBotNotifyEnabled" BOOLEAN NOT NULL DEFAULT true;

UPDATE "MessageSetting"
SET "qqBotNotifyEnabled" = true
WHERE "qqBotNotifyEnabled" IS NULL;
