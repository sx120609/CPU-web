-- Existing widget URLs were already explicitly created by their owners.
-- Keep those read-only credentials valid until the owner revokes them instead
-- of forcing every installed widget through a periodic re-authorization flow.
UPDATE "ScheduleWidgetToken"
SET "expiresAt" = NULL
WHERE "revokedAt" IS NULL;
