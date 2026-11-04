-- 全站广播（userId 为空的系统通知）按学校分开：已有的广播都是药大（cpu）发的。个人通知不填学校。
-- 每次部署都会重跑，全部语句必须可重复执行；全新库里表还不存在时跳过。
DO $$
BEGIN
    IF to_regclass('"Notification"') IS NOT NULL THEN
        ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "schoolId" TEXT;
        UPDATE "Notification" SET "schoolId" = 'cpu' WHERE "userId" IS NULL AND "schoolId" IS NULL;
        CREATE INDEX IF NOT EXISTS "Notification_schoolId_createdAt_idx" ON "Notification"("schoolId", "createdAt");
    END IF;
END
$$;
