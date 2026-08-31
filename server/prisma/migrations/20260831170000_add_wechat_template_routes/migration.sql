ALTER TABLE "WechatServiceConfig"
ADD COLUMN "workOrderTemplateId" TEXT NOT NULL DEFAULT '',
ADD COLUMN "paymentSuccessTemplateId" TEXT NOT NULL DEFAULT '';
