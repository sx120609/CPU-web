ALTER TABLE "User"
  ADD COLUMN "isVip" BOOLEAN NOT NULL DEFAULT false;

-- Any account that was ever marked as VIP becomes a permanent VIP. This is
-- intentionally independent of the former expiry timestamp.
UPDATE "User"
SET "isVip" = true
WHERE "vipLevel" > 0;

ALTER TABLE "VipGiftCode"
  ALTER COLUMN "durationDays" SET DEFAULT 0;

ALTER TABLE "VipGiftCodeRedemption"
  ALTER COLUMN "vipLevel" SET DEFAULT 1,
  ALTER COLUMN "durationDays" SET DEFAULT 0;
