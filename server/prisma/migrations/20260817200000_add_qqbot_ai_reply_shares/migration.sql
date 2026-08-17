CREATE TABLE "QqBotAiReplyShare" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "actions" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QqBotAiReplyShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QqBotAiReplyShare_token_key" ON "QqBotAiReplyShare"("token");

CREATE INDEX "QqBotAiReplyShare_expiresAt_idx" ON "QqBotAiReplyShare"("expiresAt");
