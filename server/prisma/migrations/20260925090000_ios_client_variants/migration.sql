-- Historical usedIosClient data does not distinguish native and Safari installs.
-- Preserve the aggregate; only fresh, identifiable visits set the new flags.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "usedIosNativeClient" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "usedIosPwaClient" BOOLEAN NOT NULL DEFAULT false;
