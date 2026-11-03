-- 论坛按学校隔离：板块和论坛广告归属学校，帖子、回复、点赞经由板块归属。历史数据都是药大（cpu）。
-- 板块 slug 和公告部门改为同校内唯一。联合唯一索引先在这里建好，prisma db push 只剩删旧的单列唯一索引，
-- 不会因为“新增唯一约束可能有重复值”要求 --accept-data-loss。
-- 每次部署都会重跑，全部语句必须可重复执行；全新库里表还不存在时整体跳过。
DO $$
BEGIN
    IF to_regclass('"Board"') IS NOT NULL THEN
        ALTER TABLE "Board" ADD COLUMN IF NOT EXISTS "schoolId" TEXT NOT NULL DEFAULT 'cpu';
        CREATE UNIQUE INDEX IF NOT EXISTS "Board_schoolId_slug_key" ON "Board"("schoolId", "slug");
        CREATE UNIQUE INDEX IF NOT EXISTS "Board_schoolId_feedDepartment_key" ON "Board"("schoolId", "feedDepartment");
        CREATE INDEX IF NOT EXISTS "Board_slug_idx" ON "Board"("slug");
    END IF;

    IF to_regclass('"ForumAd"') IS NOT NULL THEN
        ALTER TABLE "ForumAd" ADD COLUMN IF NOT EXISTS "schoolId" TEXT NOT NULL DEFAULT 'cpu';
        CREATE INDEX IF NOT EXISTS "ForumAd_schoolId_enabled_idx" ON "ForumAd"("schoolId", "enabled");
    END IF;
END
$$;
