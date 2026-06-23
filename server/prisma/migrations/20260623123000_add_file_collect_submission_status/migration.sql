ALTER TABLE "FileCollectSubmission"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'submitted';

CREATE INDEX "FileCollectSubmission_status_idx" ON "FileCollectSubmission"("status");
