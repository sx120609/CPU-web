-- Old blue-green instances still select this field. Drop it in a later,
-- separately reviewed contraction after those instances have retired.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "iosMajorVersion" INTEGER;
