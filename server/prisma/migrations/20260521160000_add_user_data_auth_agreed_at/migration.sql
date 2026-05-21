ALTER TABLE "User" ADD COLUMN "dataAuthAgreedAt" DATETIME;

UPDATE "User"
SET "dataAuthAgreedAt" = COALESCE("lastLoginAt", "createdAt", CURRENT_TIMESTAMP)
WHERE "studentSso" = true
  AND ("lastLoginAt" IS NOT NULL OR "createdAt" IS NOT NULL);
