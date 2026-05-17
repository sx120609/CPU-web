-- Add target client to notifications for platform-specific announcements
ALTER TABLE "Notification" ADD COLUMN "targetClient" TEXT;
