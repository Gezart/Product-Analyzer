-- CreateTable
CREATE TABLE "google_connections" (
    "shop_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "account_id" TEXT,
    "account_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "oauth_state" TEXT,
    "state_expires_at" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_connections_pkey" PRIMARY KEY ("shop_id")
);

-- CreateTable
CREATE TABLE "google_benchmarks" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "benchmark" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "google_benchmarks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_connections_oauth_state_key" ON "google_connections"("oauth_state");

-- CreateIndex
CREATE INDEX "google_benchmarks_product_id_idx" ON "google_benchmarks"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "google_benchmarks_shop_id_offer_id_country_key" ON "google_benchmarks"("shop_id", "offer_id", "country");

-- AddForeignKey
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_benchmarks" ADD CONSTRAINT "google_benchmarks_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_benchmarks" ADD CONSTRAINT "google_benchmarks_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row level security: the app connects as the table owner; nothing is exposed through the Data API.
ALTER TABLE "google_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "google_benchmarks" ENABLE ROW LEVEL SECURITY;
