ALTER TABLE "Questionnaire" ALTER COLUMN "qqBotNotifyEnabled" SET DEFAULT true;
ALTER TABLE "GradeCheckTable" ALTER COLUMN "qqBotNotifyEnabled" SET DEFAULT true;
ALTER TABLE "FileCollectTask" ALTER COLUMN "qqBotNotifyEnabled" SET DEFAULT true;
ALTER TABLE "QqBotGroup" ALTER COLUMN "notificationEnabled" SET DEFAULT true;

UPDATE "Questionnaire"
SET "qqBotNotifyEnabled" = true
WHERE "toolCode" = 'questionnaire' AND "isSystem" = false;

UPDATE "GradeCheckTable"
SET "qqBotNotifyEnabled" = true;

UPDATE "FileCollectTask"
SET "qqBotNotifyEnabled" = true;

UPDATE "QqBotGroup"
SET "notificationEnabled" = true;

UPDATE "QqBotConfig"
SET "notificationEnabled" = true;

UPDATE "QqBotConfig"
SET "notifyCategories" = regexp_replace("notifyCategories", '\]$', ',"school-feed"]')
WHERE "notifyCategories" NOT LIKE '%"school-feed"%';
