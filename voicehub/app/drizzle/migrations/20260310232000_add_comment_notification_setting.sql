ALTER TABLE "NotificationSettings"
ADD COLUMN IF NOT EXISTS "songCommentEnabled" boolean DEFAULT true NOT NULL;
