-- CreateTable
CREATE TABLE "competitor_links" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "price" DECIMAL(12,2),
    "currency" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitor_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "competitor_links_shop_id_idx" ON "competitor_links"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "competitor_links_product_id_url_key" ON "competitor_links"("product_id", "url");

-- AddForeignKey
ALTER TABLE "competitor_links" ADD CONSTRAINT "competitor_links_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_links" ADD CONSTRAINT "competitor_links_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row level security: the app connects as the table owner; nothing is exposed through the Data API.
ALTER TABLE "competitor_links" ENABLE ROW LEVEL SECURITY;
