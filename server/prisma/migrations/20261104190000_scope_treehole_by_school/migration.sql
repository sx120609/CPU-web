-- 艾绒树洞按学校隔离：人员、宣泄室、建群提议、审计日志归属学校，会话、危机个案、溯源申请经由洞主归属。
-- 历史数据都是药大（cpu）。洞主编号改为同校内唯一；联合唯一索引先在这里建好，
-- prisma db push 只剩删旧的单列唯一索引，不会要求 --accept-data-loss。
-- 每次部署都会重跑，全部语句必须可重复执行；全新库里表还不存在时跳过。
DO $$
BEGIN
    IF to_regclass('"TreeholeStaff"') IS NOT NULL THEN
        ALTER TABLE "TreeholeStaff" ADD COLUMN IF NOT EXISTS "schoolId" TEXT NOT NULL DEFAULT 'cpu';
        CREATE UNIQUE INDEX IF NOT EXISTS "TreeholeStaff_schoolId_hostCode_key" ON "TreeholeStaff"("schoolId", "hostCode");
        CREATE INDEX IF NOT EXISTS "TreeholeStaff_hostCode_idx" ON "TreeholeStaff"("hostCode");
    END IF;

    IF to_regclass('"TreeholeRoom"') IS NOT NULL THEN
        ALTER TABLE "TreeholeRoom" ADD COLUMN IF NOT EXISTS "schoolId" TEXT NOT NULL DEFAULT 'cpu';
        CREATE INDEX IF NOT EXISTS "TreeholeRoom_schoolId_status_lastMessageAt_idx" ON "TreeholeRoom"("schoolId", "status", "lastMessageAt");
    END IF;

    IF to_regclass('"TreeholeRoomProposal"') IS NOT NULL THEN
        ALTER TABLE "TreeholeRoomProposal" ADD COLUMN IF NOT EXISTS "schoolId" TEXT NOT NULL DEFAULT 'cpu';
        CREATE INDEX IF NOT EXISTS "TreeholeRoomProposal_schoolId_status_createdAt_idx" ON "TreeholeRoomProposal"("schoolId", "status", "createdAt");
    END IF;

    IF to_regclass('"TreeholeAuditLog"') IS NOT NULL THEN
        ALTER TABLE "TreeholeAuditLog" ADD COLUMN IF NOT EXISTS "schoolId" TEXT NOT NULL DEFAULT 'cpu';
        CREATE INDEX IF NOT EXISTS "TreeholeAuditLog_schoolId_createdAt_idx" ON "TreeholeAuditLog"("schoolId", "createdAt");
    END IF;
END
$$;
