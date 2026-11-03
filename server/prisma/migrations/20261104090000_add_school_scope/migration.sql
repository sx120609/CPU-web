-- 一个站服务多所学校：用户、学期校历、节次时间都归属某所学校，历史数据都是药大（cpu）。
-- prisma db push 加唯一约束时会因为“可能有重复值”要求 --accept-data-loss，
-- 所以先在这里建好新列和联合唯一索引，db push 只剩删旧的单列唯一索引。
-- 每次部署都会重跑，全部语句必须可重复执行；全新库里表还不存在时整体跳过。
DO $$
BEGIN
    IF to_regclass('"User"') IS NOT NULL THEN
        ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "schoolId" TEXT NOT NULL DEFAULT 'cpu';
        CREATE UNIQUE INDEX IF NOT EXISTS "User_schoolId_username_key" ON "User"("schoolId", "username");
        CREATE INDEX IF NOT EXISTS "User_username_idx" ON "User"("username");
    END IF;

    IF to_regclass('"ScheduleTermConfig"') IS NOT NULL THEN
        ALTER TABLE "ScheduleTermConfig" ADD COLUMN IF NOT EXISTS "schoolId" TEXT NOT NULL DEFAULT 'cpu';
        CREATE UNIQUE INDEX IF NOT EXISTS "ScheduleTermConfig_schoolId_semester_key" ON "ScheduleTermConfig"("schoolId", "semester");
    END IF;

    IF to_regclass('"SchedulePeriodConfig"') IS NOT NULL THEN
        ALTER TABLE "SchedulePeriodConfig" ADD COLUMN IF NOT EXISTS "schoolId" TEXT NOT NULL DEFAULT 'cpu';
        CREATE UNIQUE INDEX IF NOT EXISTS "SchedulePeriodConfig_schoolId_key" ON "SchedulePeriodConfig"("schoolId");
    END IF;
END
$$;
