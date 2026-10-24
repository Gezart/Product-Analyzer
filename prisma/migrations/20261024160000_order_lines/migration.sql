-- CreateTable
CREATE TABLE "order_lines" (
    "shop_id" TEXT NOT NULL,
    "line_gid" TEXT NOT NULL,
    "order_gid" TEXT NOT NULL,
    "product_gid" TEXT NOT NULL,
    "variant_gid" TEXT,
    "date" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "revenue" DECIMAL(14,2) NOT NULL,
    "order_updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("shop_id","line_gid")
);

-- CreateIndex
CREATE INDEX "order_lines_shop_id_order_gid_idx" ON "order_lines"("shop_id", "order_gid");

-- CreateIndex
CREATE INDEX "order_lines_shop_id_product_gid_date_idx" ON "order_lines"("shop_id", "product_gid", "date");

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Block Supabase Data API access (app uses Prisma only).
ALTER TABLE "order_lines" ENABLE ROW LEVEL SECURITY;
