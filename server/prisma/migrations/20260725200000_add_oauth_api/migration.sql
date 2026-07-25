CREATE TABLE "OAuthAuthorizationCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "codeChallengeMethod" TEXT NOT NULL DEFAULT 'S256',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthAuthorizationCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OAuthAuthorizationCode_codeHash_key" ON "OAuthAuthorizationCode"("codeHash");
CREATE INDEX "OAuthAuthorizationCode_userId_expiresAt_idx" ON "OAuthAuthorizationCode"("userId", "expiresAt");
CREATE INDEX "OAuthAuthorizationCode_clientId_expiresAt_idx" ON "OAuthAuthorizationCode"("clientId", "expiresAt");
ALTER TABLE "OAuthAuthorizationCode" ADD CONSTRAINT "OAuthAuthorizationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OAuthAccessToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "OAuthAccessToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OAuthAccessToken_tokenHash_key" ON "OAuthAccessToken"("tokenHash");
CREATE INDEX "OAuthAccessToken_userId_expiresAt_idx" ON "OAuthAccessToken"("userId", "expiresAt");
CREATE INDEX "OAuthAccessToken_clientId_expiresAt_idx" ON "OAuthAccessToken"("clientId", "expiresAt");
ALTER TABLE "OAuthAccessToken" ADD CONSTRAINT "OAuthAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
