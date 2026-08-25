ALTER TABLE "WechatBindToken"
ADD COLUMN "token" TEXT;

CREATE UNIQUE INDEX "WechatBindToken_token_key" ON "WechatBindToken"("token");
