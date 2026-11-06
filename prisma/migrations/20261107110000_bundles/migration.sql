-- CreateTable
CREATE TABLE "bundles" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "pct" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "discount_gid" TEXT,
    "status" TEXT NOT NULL DEFAULT 'starting',
    "cleanup" BOOLEAN NOT NULL DEFAULT false,
    "end_reason" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bundles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bundles_shop_id_status_idx" ON "bundles"("shop_id", "status");

-- AddForeignKey
ALTER TABLE "bundles" ADD CONSTRAINT "bundles_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundles" ADD CONSTRAINT "bundles_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundles" ADD CONSTRAINT "bundles_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one running bundle per product on each side (double clicks, two tabs), enforced by the database.
CREATE UNIQUE INDEX "bundles_one_per_product" ON "bundles"("product_id") WHERE "status" IN ('starting', 'active');
CREATE UNIQUE INDEX "bundles_one_per_partner" ON "bundles"("partner_id") WHERE "status" IN ('starting', 'active');

-- Row level security: the app connects as the table owner; nothing is exposed through the Data API.
ALTER TABLE "bundles" ENABLE ROW LEVEL SECURITY;
