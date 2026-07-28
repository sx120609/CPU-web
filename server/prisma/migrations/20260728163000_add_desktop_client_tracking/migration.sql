ALTER TABLE "User"
ADD COLUMN "usedDesktopClient" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User"
SET "usedDesktopClient" = true
WHERE "lastLoginClient" = 'desktop';
