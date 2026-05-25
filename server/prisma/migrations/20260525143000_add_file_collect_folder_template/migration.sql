-- AlterTable
ALTER TABLE "FileCollectTask" ADD COLUMN "folderTemplate" TEXT NOT NULL DEFAULT '{name}-{student_id}';

-- AlterTable
ALTER TABLE "FileCollectTemplate" ADD COLUMN "folderTemplate" TEXT NOT NULL DEFAULT '{name}-{student_id}';
