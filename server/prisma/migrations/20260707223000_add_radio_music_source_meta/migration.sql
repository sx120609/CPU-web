ALTER TABLE "RadioSongRequest"
ADD COLUMN "sourceProvider" TEXT,
ADD COLUMN "sourceTrackId" TEXT,
ADD COLUMN "sourceTrackMeta" TEXT NOT NULL DEFAULT '{}';

CREATE INDEX "RadioSongRequest_sourceProvider_createdAt_idx"
ON "RadioSongRequest"("sourceProvider", "createdAt");
