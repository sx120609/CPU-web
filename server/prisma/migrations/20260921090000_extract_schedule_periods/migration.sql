-- 节次时间从每个学期一份收敛为全校一份。先建表并把现有值搬过去，
-- 再删掉 ScheduleTermConfig.periods 列。
CREATE TABLE IF NOT EXISTS "SchedulePeriodConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "periods" TEXT NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SchedulePeriodConfig_pkey" PRIMARY KEY ("id")
);

-- 取最近更新的那个学期的节次时间；表还不存在（全新库）时跳过。
DO $$
BEGIN
    IF to_regclass('"ScheduleTermConfig"') IS NOT NULL
       AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_name = 'ScheduleTermConfig' AND column_name = 'periods'
       ) THEN
        INSERT INTO "SchedulePeriodConfig" ("id", "periods", "version")
        SELECT 1, "periods", 1
        FROM "ScheduleTermConfig"
        WHERE "periods" IS NOT NULL AND "periods" <> '' AND "periods" <> '[]'
        ORDER BY "updatedAt" DESC
        LIMIT 1
        ON CONFLICT ("id") DO NOTHING;
    END IF;
END
$$;

-- 没有任何学期时也要有这一行，读取端不必处理缺行。
INSERT INTO "SchedulePeriodConfig" ("id", "periods")
VALUES (1, '[]')
ON CONFLICT ("id") DO NOTHING;

-- 显式删列：留给 `prisma db push` 的话它会因为数据丢失风险拒绝执行。
ALTER TABLE IF EXISTS "ScheduleTermConfig" DROP COLUMN IF EXISTS "periods";
