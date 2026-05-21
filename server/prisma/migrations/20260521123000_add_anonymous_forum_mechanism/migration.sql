ALTER TABLE "User" ADD COLUMN "anonymousCredits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "anonymousWeekKey" TEXT;
ALTER TABLE "User" ADD COLUMN "anonymousCreditsFrozen" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Board" ADD COLUMN "anonymousEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Topic" ADD COLUMN "isAnonymous" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Topic" ADD COLUMN "anonymousAlias" TEXT;

ALTER TABLE "Reply" ADD COLUMN "isAnonymous" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Reply" ADD COLUMN "anonymousAlias" TEXT;

UPDATE "Board"
SET "anonymousEnabled" = true
WHERE "slug" = 'treehole';
