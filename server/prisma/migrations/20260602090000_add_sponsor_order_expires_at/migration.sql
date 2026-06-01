ALTER TABLE "SponsorOrder" ADD COLUMN "expiresAt" DATETIME;
UPDATE "SponsorOrder"
SET "expiresAt" = DATETIME("createdAt", '+3 hours')
WHERE "status" = 'pending' AND "expiresAt" IS NULL;
