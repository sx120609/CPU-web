ALTER TABLE "MessageSetting"
ADD COLUMN "wechatNotifyEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "WechatServiceConfig" (
    "id" SERIAL NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "accountName" TEXT NOT NULL DEFAULT '',
    "appId" TEXT NOT NULL DEFAULT '',
    "appSecret" TEXT NOT NULL DEFAULT '',
    "token" TEXT NOT NULL DEFAULT '',
    "encodingAesKey" TEXT NOT NULL DEFAULT '',
    "messageMode" TEXT NOT NULL DEFAULT 'safe',
    "notificationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "assistantEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyCategories" TEXT NOT NULL DEFAULT '["reply","mention","like","system","service-tool","lost-found","school-feed"]',
    "notificationTemplateId" TEXT NOT NULL DEFAULT '',
    "templateTitleField" TEXT NOT NULL DEFAULT '',
    "templateContentField" TEXT NOT NULL DEFAULT '',
    "templateTimeField" TEXT NOT NULL DEFAULT '',
    "templateRemarkField" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WechatServiceConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WechatBinding" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "openId" TEXT NOT NULL,
    "unionId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "subscribed" BOOLEAN NOT NULL DEFAULT true,
    "subscribedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "lastInteractionAt" TIMESTAMP(3),
    "lastInteractionType" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WechatBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WechatBindToken" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WechatBindToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WechatOauthState" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "stateHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WechatOauthState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WechatMessageLog" (
    "id" SERIAL NOT NULL,
    "direction" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "openId" TEXT,
    "userId" INTEGER,
    "messageId" TEXT,
    "notificationId" INTEGER,
    "content" TEXT,
    "result" TEXT,
    "rawPayload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WechatMessageLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WechatBinding_userId_key" ON "WechatBinding"("userId");
CREATE UNIQUE INDEX "WechatBinding_openId_key" ON "WechatBinding"("openId");
CREATE INDEX "WechatBinding_enabled_subscribed_idx" ON "WechatBinding"("enabled", "subscribed");
CREATE INDEX "WechatBinding_unionId_idx" ON "WechatBinding"("unionId");
CREATE UNIQUE INDEX "WechatBindToken_tokenHash_key" ON "WechatBindToken"("tokenHash");
CREATE INDEX "WechatBindToken_userId_expiresAt_idx" ON "WechatBindToken"("userId", "expiresAt");
CREATE UNIQUE INDEX "WechatOauthState_stateHash_key" ON "WechatOauthState"("stateHash");
CREATE INDEX "WechatOauthState_userId_expiresAt_idx" ON "WechatOauthState"("userId", "expiresAt");
CREATE UNIQUE INDEX "WechatMessageLog_messageId_key" ON "WechatMessageLog"("messageId");
CREATE INDEX "WechatMessageLog_notificationId_userId_status_idx" ON "WechatMessageLog"("notificationId", "userId", "status");
CREATE INDEX "WechatMessageLog_openId_createdAt_idx" ON "WechatMessageLog"("openId", "createdAt");
CREATE INDEX "WechatMessageLog_eventType_status_createdAt_idx" ON "WechatMessageLog"("eventType", "status", "createdAt");

ALTER TABLE "WechatBinding" ADD CONSTRAINT "WechatBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WechatBindToken" ADD CONSTRAINT "WechatBindToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WechatOauthState" ADD CONSTRAINT "WechatOauthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WechatMessageLog" ADD CONSTRAINT "WechatMessageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
