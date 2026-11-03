-- AlterTable
ALTER TABLE "ai_usage" ADD COLUMN     "photo_calls" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "photo_cost_usd" DECIMAL(10,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ai_photo_drafts" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "source_media_id" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "scene" TEXT,
    "image" BYTEA,
    "mime_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "media_id" TEXT,
    "fix_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_photo_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_photo_drafts_shop_id_created_at_idx" ON "ai_photo_drafts"("shop_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_photo_drafts_product_id_status_idx" ON "ai_photo_drafts"("product_id", "status");

-- AddForeignKey
ALTER TABLE "ai_photo_drafts" ADD CONSTRAINT "ai_photo_drafts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_photo_drafts" ADD CONSTRAINT "ai_photo_drafts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row level security: the app connects as the table owner; nothing is exposed through the Data API.
ALTER TABLE "ai_photo_drafts" ENABLE ROW LEVEL SECURITY;
