-- CreateTable
CREATE TABLE "ab_tests" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "a" JSONB NOT NULL,
    "b" JSONB NOT NULL,
    "previews" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'starting',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "end_reason" TEXT,
    "winner" TEXT,
    "result" JSONB,
    "fix_id" TEXT,
    "claimed_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ab_test_visitors" (
    "test_id" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "carted_at" TIMESTAMP(3),

    CONSTRAINT "ab_test_visitors_pkey" PRIMARY KEY ("test_id","visitor_id")
);

-- CreateTable
CREATE TABLE "ab_test_purchases" (
    "test_id" TEXT NOT NULL,
    "line_gid" TEXT NOT NULL,
    "order_gid" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "revenue" DECIMAL(14,2) NOT NULL,
    "ordered_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ab_test_purchases_pkey" PRIMARY KEY ("test_id","line_gid")
);

-- CreateIndex
CREATE INDEX "ab_tests_shop_id_status_idx" ON "ab_tests"("shop_id", "status");

-- CreateIndex
CREATE INDEX "ab_tests_product_id_idx" ON "ab_tests"("product_id");

-- CreateIndex
CREATE INDEX "ab_test_visitors_test_id_variant_idx" ON "ab_test_visitors"("test_id", "variant");

-- CreateIndex
CREATE INDEX "ab_test_purchases_test_id_variant_idx" ON "ab_test_purchases"("test_id", "variant");

-- AddForeignKey
ALTER TABLE "ab_tests" ADD CONSTRAINT "ab_tests_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ab_tests" ADD CONSTRAINT "ab_tests_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ab_test_visitors" ADD CONSTRAINT "ab_test_visitors_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "ab_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ab_test_purchases" ADD CONSTRAINT "ab_test_purchases_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "ab_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one test per product starts, runs or is being applied at a time (double clicks, two tabs),
-- enforced by the database.
CREATE UNIQUE INDEX "ab_tests_one_running_per_product" ON "ab_tests"("product_id") WHERE "status" IN ('starting', 'running', 'applying');

-- Row level security: the app connects as the table owner; nothing is exposed through the Data API.
ALTER TABLE "ab_tests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ab_test_visitors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ab_test_purchases" ENABLE ROW LEVEL SECURITY;
