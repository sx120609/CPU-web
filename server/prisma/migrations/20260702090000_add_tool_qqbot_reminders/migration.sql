ALTER TABLE "Questionnaire" ADD COLUMN "qqBotNotifyEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Questionnaire" ADD COLUMN "qqBotNotifyConfig" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "GradeCheckTable" ADD COLUMN "qqBotNotifyEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GradeCheckTable" ADD COLUMN "qqBotNotifyConfig" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "FileCollectTask" ADD COLUMN "qqBotNotifyEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FileCollectTask" ADD COLUMN "qqBotNotifyConfig" TEXT NOT NULL DEFAULT '{}';

CREATE INDEX "Questionnaire_qqBotNotifyEnabled_idx" ON "Questionnaire"("qqBotNotifyEnabled");
CREATE INDEX "GradeCheckTable_qqBotNotifyEnabled_idx" ON "GradeCheckTable"("qqBotNotifyEnabled");
CREATE INDEX "FileCollectTask_qqBotNotifyEnabled_idx" ON "FileCollectTask"("qqBotNotifyEnabled");

UPDATE "QqBotConfig"
SET "notifyCategories" = regexp_replace("notifyCategories", '\]$', ',"service-tool"]')
WHERE "notifyCategories" NOT LIKE '%"service-tool"%';
