ALTER TABLE "FileCollectTask" ADD COLUMN "surveyFields" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "FileCollectTemplate" ADD COLUMN "surveyFields" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "FileCollectSubmission" ADD COLUMN "answers" TEXT NOT NULL DEFAULT '{}';
