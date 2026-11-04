-- 课程目录、授课老师、办事入口按学校分开，历史数据都是药大（cpu）。课程代码、老师姓名、入口代码改为同校内唯一。
-- 联合唯一索引先在这里建好，prisma db push 只剩删旧的单列唯一索引，不会要求 --accept-data-loss。
-- 每次部署都会重跑，全部语句必须可重复执行；全新库里表还不存在时跳过。
DO $$
BEGIN
    IF to_regclass('"Course"') IS NOT NULL THEN
        ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "schoolId" TEXT NOT NULL DEFAULT 'cpu';
        CREATE UNIQUE INDEX IF NOT EXISTS "Course_schoolId_code_key" ON "Course"("schoolId", "code");
        CREATE INDEX IF NOT EXISTS "Course_code_idx" ON "Course"("code");
    END IF;

    IF to_regclass('"Teacher"') IS NOT NULL THEN
        ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "schoolId" TEXT NOT NULL DEFAULT 'cpu';
        CREATE UNIQUE INDEX IF NOT EXISTS "Teacher_schoolId_name_key" ON "Teacher"("schoolId", "name");
        CREATE INDEX IF NOT EXISTS "Teacher_name_idx" ON "Teacher"("name");
    END IF;

    IF to_regclass('"ServiceCard"') IS NOT NULL THEN
        ALTER TABLE "ServiceCard" ADD COLUMN IF NOT EXISTS "schoolId" TEXT NOT NULL DEFAULT 'cpu';
        CREATE UNIQUE INDEX IF NOT EXISTS "ServiceCard_schoolId_code_key" ON "ServiceCard"("schoolId", "code");
        CREATE INDEX IF NOT EXISTS "ServiceCard_schoolId_hidden_order_idx" ON "ServiceCard"("schoolId", "hidden", "order");
    END IF;
END
$$;
