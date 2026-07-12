-- CreateTable
CREATE TABLE "MarketItem" (
    "id" SERIAL NOT NULL,
    "topicId" INTEGER,
    "sellerId" INTEGER NOT NULL,
    "listingType" TEXT NOT NULL DEFAULT 'sell',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "priceCents" INTEGER NOT NULL,
    "originalPriceCents" INTEGER,
    "negotiable" BOOLEAN NOT NULL DEFAULT false,
    "condition" TEXT NOT NULL DEFAULT 'good',
    "tradeMode" TEXT NOT NULL DEFAULT 'meetup',
    "campus" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "favoriteCount" INTEGER NOT NULL DEFAULT 0,
    "offerCount" INTEGER NOT NULL DEFAULT 0,
    "soldAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketImage" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketFavorite" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketOffer" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "buyerId" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketOrder" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "offerId" INTEGER NOT NULL,
    "buyerId" INTEGER NOT NULL,
    "sellerId" INTEGER NOT NULL,
    "outTradeNo" TEXT NOT NULL,
    "tradeNo" TEXT,
    "payType" TEXT NOT NULL DEFAULT '',
    "amountCents" INTEGER NOT NULL,
    "platformFeeCents" INTEGER NOT NULL DEFAULT 0,
    "sellerAmountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_payment',
    "meetupTime" TIMESTAMP(3),
    "meetupLocation" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "buyerConfirmedAt" TIMESTAMP(3),
    "sellerConfirmedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketConversation" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "orderId" INTEGER,
    "buyerId" INTEGER NOT NULL,
    "sellerId" INTEGER NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketMessage" (
    "id" SERIAL NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "senderId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketReview" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "targetUserId" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketReport" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "reporterId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "handledById" INTEGER,
    "handledNote" TEXT NOT NULL DEFAULT '',
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketPaymentLog" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER,
    "outTradeNo" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'epay',
    "event" TEXT NOT NULL DEFAULT 'notify',
    "rawPayload" TEXT NOT NULL DEFAULT '{}',
    "signOk" BOOLEAN NOT NULL DEFAULT false,
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "result" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketPaymentLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketRefund" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "requestedById" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "providerRefundNo" TEXT,
    "handledById" INTEGER,
    "handledNote" TEXT NOT NULL DEFAULT '',
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSettlement" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "sellerId" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "availableAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "reference" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketPayoutProfile" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'alipay',
    "accountEncrypted" TEXT NOT NULL,
    "accountMasked" TEXT NOT NULL,
    "realNameEncrypted" TEXT NOT NULL,
    "realNameMasked" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketPayoutProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketItem_topicId_key" ON "MarketItem"("topicId");

-- CreateIndex
CREATE INDEX "MarketItem_status_createdAt_idx" ON "MarketItem"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketItem_category_status_createdAt_idx" ON "MarketItem"("category", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketItem_sellerId_status_updatedAt_idx" ON "MarketItem"("sellerId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "MarketItem_listingType_status_createdAt_idx" ON "MarketItem"("listingType", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketItem_priceCents_idx" ON "MarketItem"("priceCents");

-- CreateIndex
CREATE INDEX "MarketImage_itemId_sort_idx" ON "MarketImage"("itemId", "sort");

-- CreateIndex
CREATE INDEX "MarketFavorite_userId_createdAt_idx" ON "MarketFavorite"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketFavorite_itemId_userId_key" ON "MarketFavorite"("itemId", "userId");

-- CreateIndex
CREATE INDEX "MarketOffer_itemId_status_createdAt_idx" ON "MarketOffer"("itemId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketOffer_buyerId_status_createdAt_idx" ON "MarketOffer"("buyerId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketOrder_offerId_key" ON "MarketOrder"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketOrder_outTradeNo_key" ON "MarketOrder"("outTradeNo");

-- CreateIndex
CREATE INDEX "MarketOrder_buyerId_status_createdAt_idx" ON "MarketOrder"("buyerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketOrder_sellerId_status_createdAt_idx" ON "MarketOrder"("sellerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketOrder_status_expiresAt_idx" ON "MarketOrder"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "MarketOrder_itemId_createdAt_idx" ON "MarketOrder"("itemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketConversation_orderId_key" ON "MarketConversation"("orderId");

-- CreateIndex
CREATE INDEX "MarketConversation_buyerId_lastMessageAt_idx" ON "MarketConversation"("buyerId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "MarketConversation_sellerId_lastMessageAt_idx" ON "MarketConversation"("sellerId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketConversation_itemId_buyerId_sellerId_key" ON "MarketConversation"("itemId", "buyerId", "sellerId");

-- CreateIndex
CREATE INDEX "MarketMessage_conversationId_createdAt_idx" ON "MarketMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketMessage_senderId_createdAt_idx" ON "MarketMessage"("senderId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketReview_targetUserId_createdAt_idx" ON "MarketReview"("targetUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketReview_orderId_authorId_key" ON "MarketReview"("orderId", "authorId");

-- CreateIndex
CREATE INDEX "MarketReport_status_createdAt_idx" ON "MarketReport"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketReport_itemId_reporterId_key" ON "MarketReport"("itemId", "reporterId");

-- CreateIndex
CREATE INDEX "MarketPaymentLog_outTradeNo_idx" ON "MarketPaymentLog"("outTradeNo");

-- CreateIndex
CREATE INDEX "MarketPaymentLog_createdAt_idx" ON "MarketPaymentLog"("createdAt");

-- CreateIndex
CREATE INDEX "MarketRefund_orderId_status_idx" ON "MarketRefund"("orderId", "status");

-- CreateIndex
CREATE INDEX "MarketRefund_status_createdAt_idx" ON "MarketRefund"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSettlement_orderId_key" ON "MarketSettlement"("orderId");

-- CreateIndex
CREATE INDEX "MarketSettlement_sellerId_status_createdAt_idx" ON "MarketSettlement"("sellerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketSettlement_status_availableAt_idx" ON "MarketSettlement"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketPayoutProfile_userId_key" ON "MarketPayoutProfile"("userId");

-- AddForeignKey
ALTER TABLE "MarketItem" ADD CONSTRAINT "MarketItem_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketItem" ADD CONSTRAINT "MarketItem_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketImage" ADD CONSTRAINT "MarketImage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MarketItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketFavorite" ADD CONSTRAINT "MarketFavorite_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MarketItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketFavorite" ADD CONSTRAINT "MarketFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketOffer" ADD CONSTRAINT "MarketOffer_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MarketItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketOffer" ADD CONSTRAINT "MarketOffer_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketOrder" ADD CONSTRAINT "MarketOrder_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MarketItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketOrder" ADD CONSTRAINT "MarketOrder_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "MarketOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketOrder" ADD CONSTRAINT "MarketOrder_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketOrder" ADD CONSTRAINT "MarketOrder_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketConversation" ADD CONSTRAINT "MarketConversation_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MarketItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketConversation" ADD CONSTRAINT "MarketConversation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketConversation" ADD CONSTRAINT "MarketConversation_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketConversation" ADD CONSTRAINT "MarketConversation_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketMessage" ADD CONSTRAINT "MarketMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "MarketConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketMessage" ADD CONSTRAINT "MarketMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketReview" ADD CONSTRAINT "MarketReview_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketReview" ADD CONSTRAINT "MarketReview_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketReview" ADD CONSTRAINT "MarketReview_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketReport" ADD CONSTRAINT "MarketReport_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MarketItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketReport" ADD CONSTRAINT "MarketReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPaymentLog" ADD CONSTRAINT "MarketPaymentLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketRefund" ADD CONSTRAINT "MarketRefund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketRefund" ADD CONSTRAINT "MarketRefund_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSettlement" ADD CONSTRAINT "MarketSettlement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSettlement" ADD CONSTRAINT "MarketSettlement_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPayoutProfile" ADD CONSTRAINT "MarketPayoutProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill legacy forum-style market topics without removing their replies or likes.
INSERT INTO "MarketItem" (
  "topicId", "sellerId", "listingType", "title", "description", "category",
  "priceCents", "negotiable", "condition", "tradeMode", "campus", "location",
  "status", "viewCount", "createdAt", "updatedAt"
)
SELECT
  t."id",
  t."authorId",
  CASE
    WHEN COALESCE(t."metadata"::jsonb ->> 'listingType', '') = 'wanted'
      OR COALESCE(t."metadata"::jsonb ->> 'condition', '') IN ('求购', 'wanted')
    THEN 'wanted' ELSE 'sell'
  END,
  t."title",
  t."content",
  COALESCE(NULLIF(t."metadata"::jsonb ->> 'category', ''),
    CASE WHEN t."title" ~* '(教材|课本|textbook|book)' THEN 'books' ELSE 'other' END),
  GREATEST(0, ROUND(COALESCE(NULLIF(t."metadata"::jsonb ->> 'price', '')::numeric, 0) * 100)::integer),
  COALESCE((t."metadata"::jsonb ->> 'negotiable')::boolean, false),
  CASE COALESCE(t."metadata"::jsonb ->> 'condition', '')
    WHEN '全新' THEN 'new'
    WHEN '九成新' THEN 'like_new'
    WHEN '八成新' THEN 'good'
    WHEN '七成新及以下' THEN 'fair'
    WHEN '求购' THEN 'wanted'
    ELSE COALESCE(NULLIF(t."metadata"::jsonb ->> 'condition', ''), 'good')
  END,
  CASE COALESCE(t."metadata"::jsonb ->> 'tradeMode', '')
    WHEN '当面' THEN 'meetup'
    WHEN '包邮' THEN 'shipping'
    WHEN '当面 / 包邮+5' THEN 'both'
    ELSE COALESCE(NULLIF(t."metadata"::jsonb ->> 'tradeMode', ''), 'meetup')
  END,
  COALESCE(t."metadata"::jsonb ->> 'campus', ''),
  COALESCE(t."metadata"::jsonb ->> 'location', ''),
  CASE WHEN t."hidden" THEN 'hidden' WHEN t."locked" THEN 'withdrawn' ELSE 'active' END,
  t."viewCount",
  t."createdAt",
  t."updatedAt"
FROM "Topic" t
JOIN "Board" b ON b."id" = t."boardId" AND b."type" = 'market'
WHERE t."metadata" ~ '^\s*\{'
  AND NOT EXISTS (SELECT 1 FROM "MarketItem" m WHERE m."topicId" = t."id");

INSERT INTO "MarketImage" ("itemId", "url", "sort", "createdAt")
SELECT m."id", image."url", image."ordinality" - 1, CURRENT_TIMESTAMP
FROM "MarketItem" m
JOIN "Topic" t ON t."id" = m."topicId"
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE
    WHEN jsonb_typeof(t."metadata"::jsonb -> 'images') = 'array' THEN t."metadata"::jsonb -> 'images'
    ELSE '[]'::jsonb
  END
) WITH ORDINALITY AS image("url", "ordinality")
WHERE t."metadata" ~ '^\s*\{'
  AND image."url" <> '';

