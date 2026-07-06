CREATE TABLE "RadioMusicAuth" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "cookieText" TEXT NOT NULL DEFAULT '',
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RadioMusicAuth_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RadioMusicAuth_provider_key" ON "RadioMusicAuth"("provider");
CREATE INDEX "RadioMusicAuth_updatedById_idx" ON "RadioMusicAuth"("updatedById");

ALTER TABLE "RadioMusicAuth" ADD CONSTRAINT "RadioMusicAuth_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
