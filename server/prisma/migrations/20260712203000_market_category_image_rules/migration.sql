ALTER TABLE "MarketCategory"
  ADD COLUMN "imageRequired" BOOLEAN NOT NULL DEFAULT true;

-- Electronic materials can use a cover or preview image, but it is optional.
UPDATE "MarketCategory"
SET "imageRequired" = false
WHERE "slug" = 'digital_goods';

