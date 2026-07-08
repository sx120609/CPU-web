CREATE TABLE "AdminDailyLogin" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "dateKey" TEXT NOT NULL,
    "client" TEXT,
    "firstLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminDailyLogin_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AdminDailyLogin" ADD CONSTRAINT "AdminDailyLogin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "AdminDailyLogin_userId_dateKey_key" ON "AdminDailyLogin"("userId", "dateKey");
CREATE INDEX "AdminDailyLogin_dateKey_idx" ON "AdminDailyLogin"("dateKey");
CREATE INDEX "AdminDailyLogin_dateKey_userId_idx" ON "AdminDailyLogin"("dateKey", "userId");
CREATE INDEX "AdminDailyLogin_userId_lastLoginAt_idx" ON "AdminDailyLogin"("userId", "lastLoginAt");
