CREATE TABLE IF NOT EXISTS "LiveActivityDevice" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "startTokenHash" TEXT,
    "startTokenCiphertext" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "bundleID" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "broadcastEnabled" BOOLEAN NOT NULL DEFAULT false,
    "channelID" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "planDigest" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LiveActivityDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LiveActivityDevice_startTokenHash_key" ON "LiveActivityDevice"("startTokenHash");
CREATE INDEX IF NOT EXISTS "LiveActivityDevice_userId_enabled_idx" ON "LiveActivityDevice"("userId", "enabled");
CREATE INDEX IF NOT EXISTS "LiveActivityDevice_enabled_updatedAt_idx" ON "LiveActivityDevice"("enabled", "updatedAt");
CREATE INDEX IF NOT EXISTS "LiveActivityDevice_broadcastEnabled_channelID_idx" ON "LiveActivityDevice"("broadcastEnabled", "channelID");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'LiveActivityDevice_userId_fkey' AND conrelid = '"LiveActivityDevice"'::regclass
  ) THEN
    ALTER TABLE "LiveActivityDevice" ADD CONSTRAINT "LiveActivityDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "LiveActivityPlan" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "itemID" TEXT NOT NULL,
    "fireAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "event" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "detail" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LiveActivityPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LiveActivityPlan_deviceId_itemID_key" ON "LiveActivityPlan"("deviceId", "itemID");
CREATE INDEX IF NOT EXISTS "LiveActivityPlan_state_fireAt_idx" ON "LiveActivityPlan"("state", "fireAt");
CREATE INDEX IF NOT EXISTS "LiveActivityPlan_deviceId_state_fireAt_idx" ON "LiveActivityPlan"("deviceId", "state", "fireAt");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'LiveActivityPlan_deviceId_fkey' AND conrelid = '"LiveActivityPlan"'::regclass
  ) THEN
    ALTER TABLE "LiveActivityPlan" ADD CONSTRAINT "LiveActivityPlan_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "LiveActivityDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "LiveActivityDeviceActivity" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "activityID" TEXT NOT NULL,
    "updateTokenHash" TEXT NOT NULL,
    "updateTokenCiphertext" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LiveActivityDeviceActivity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LiveActivityDeviceActivity_deviceId_activityID_key" ON "LiveActivityDeviceActivity"("deviceId", "activityID");
CREATE UNIQUE INDEX IF NOT EXISTS "LiveActivityDeviceActivity_updateTokenHash_key" ON "LiveActivityDeviceActivity"("updateTokenHash");
CREATE INDEX IF NOT EXISTS "LiveActivityDeviceActivity_deviceId_expiresAt_idx" ON "LiveActivityDeviceActivity"("deviceId", "expiresAt");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'LiveActivityDeviceActivity_deviceId_fkey' AND conrelid = '"LiveActivityDeviceActivity"'::regclass
  ) THEN
    ALTER TABLE "LiveActivityDeviceActivity" ADD CONSTRAINT "LiveActivityDeviceActivity_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "LiveActivityDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "LiveActivityBroadcastEvent" (
    "id" TEXT NOT NULL,
    "channelID" TEXT NOT NULL,
    "eventID" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "bundleID" TEXT NOT NULL,
    "fireAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "event" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "detail" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LiveActivityBroadcastEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LiveActivityBroadcastEvent_channelID_eventID_key" ON "LiveActivityBroadcastEvent"("channelID", "eventID");
CREATE INDEX IF NOT EXISTS "LiveActivityBroadcastEvent_state_fireAt_idx" ON "LiveActivityBroadcastEvent"("state", "fireAt");
