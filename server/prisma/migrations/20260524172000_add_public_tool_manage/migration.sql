-- AlterTable
ALTER TABLE "ToolSetting" ADD COLUMN "allowPublicManage" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "ToolSetting_allowPublicManage_idx" ON "ToolSetting"("allowPublicManage");
