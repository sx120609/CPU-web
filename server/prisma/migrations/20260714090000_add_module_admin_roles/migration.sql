-- Module permissions are independent from the primary site role so one account
-- can administer multiple tools at the same time.
ALTER TABLE "User"
ADD COLUMN "voiceHubRole" TEXT,
ADD COLUMN "lostFoundRole" TEXT;

ALTER TABLE "User"
ADD CONSTRAINT "User_voiceHubRole_check"
  CHECK ("voiceHubRole" IS NULL OR "voiceHubRole" IN ('admin', 'super_admin')),
ADD CONSTRAINT "User_lostFoundRole_check"
  CHECK ("lostFoundRole" IS NULL OR "lostFoundRole" IN ('admin', 'super_admin'));

-- Preserve the legacy single-role VoiceHub administrators.
UPDATE "User"
SET "voiceHubRole" = 'admin',
    "role" = 'user'
WHERE "role" = 'voicehub_admin';
