-- Anonymous outcomes reported by the Windows desktop installer.
-- CreateTable
CREATE TABLE IF NOT EXISTS "DesktopInstallReport" (
    "id" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "previousVersion" TEXT,
    "osRelease" TEXT NOT NULL,
    "arch" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "elevated" BOOLEAN NOT NULL DEFAULT false,
    "outcome" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "errorCode" TEXT,
    "fileName" TEXT,
    "message" TEXT,
    "antivirus" TEXT NOT NULL DEFAULT '[]',
    "retries" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesktopInstallReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DesktopInstallReport_outcome_createdAt_idx" ON "DesktopInstallReport"("outcome", "createdAt");
CREATE INDEX IF NOT EXISTS "DesktopInstallReport_createdAt_idx" ON "DesktopInstallReport"("createdAt");
CREATE INDEX IF NOT EXISTS "DesktopInstallReport_errorCode_idx" ON "DesktopInstallReport"("errorCode");
CREATE INDEX IF NOT EXISTS "DesktopInstallReport_appVersion_idx" ON "DesktopInstallReport"("appVersion");
