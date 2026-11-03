-- CreateTable
CREATE TABLE "line_refunds" (
    "shop_id" TEXT NOT NULL,
    "line_gid" TEXT NOT NULL,
    "order_gid" TEXT NOT NULL,
    "product_gid" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "returned_qty" INTEGER NOT NULL,
    "refunded_amount" DECIMAL(14,2) NOT NULL,
    "order_updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "line_refunds_pkey" PRIMARY KEY ("shop_id","line_gid")
);

-- CreateTable
CREATE TABLE "return_reasons" (
    "shop_id" TEXT NOT NULL,
    "return_line_gid" TEXT NOT NULL,
    "order_gid" TEXT NOT NULL,
    "line_gid" TEXT NOT NULL,
    "product_gid" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "reason_name" TEXT NOT NULL,
    "order_updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_reasons_pkey" PRIMARY KEY ("shop_id","return_line_gid")
);

-- CreateIndex
CREATE INDEX "line_refunds_shop_id_order_gid_idx" ON "line_refunds"("shop_id", "order_gid");

-- CreateIndex
CREATE INDEX "line_refunds_shop_id_product_gid_date_idx" ON "line_refunds"("shop_id", "product_gid", "date");

-- CreateIndex
CREATE INDEX "return_reasons_shop_id_order_gid_idx" ON "return_reasons"("shop_id", "order_gid");

-- CreateIndex
CREATE INDEX "return_reasons_shop_id_product_gid_date_idx" ON "return_reasons"("shop_id", "product_gid", "date");

-- AddForeignKey
ALTER TABLE "line_refunds" ADD CONSTRAINT "line_refunds_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_reasons" ADD CONSTRAINT "return_reasons_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row level security: the app connects as the table owner; nothing is exposed through the Data API.
ALTER TABLE "line_refunds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "return_reasons" ENABLE ROW LEVEL SECURITY;
