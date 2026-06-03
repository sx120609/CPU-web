ALTER TABLE "ToolSetting"
ADD COLUMN "isVisible" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "ToolSetting_isVisible_idx" ON "ToolSetting"("isVisible");
