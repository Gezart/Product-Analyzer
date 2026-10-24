-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "accessToken" TEXT NOT NULL,
    "expires" TIMESTAMP(3),
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shops" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "currency" TEXT,
    "timezone" TEXT,
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalled_at" TIMESTAMP(3),

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "shop_id" TEXT NOT NULL,
    "thresholds" JSONB NOT NULL DEFAULT '{}',
    "margin_floor_pct" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "max_discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 40,
    "excluded_collection_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "digest_day" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("shop_id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "shopify_gid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "product_type" TEXT,
    "vendor" TEXT,
    "collections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "image_count" INTEGER NOT NULL DEFAULT 0,
    "description_words" INTEGER NOT NULL DEFAULT 0,
    "price" DECIMAL(12,2) NOT NULL,
    "compare_at_price" DECIMAL(12,2),
    "cost" DECIMAL(12,2),
    "status" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variants" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "shopify_gid" TEXT NOT NULL,
    "sku" TEXT,
    "options" JSONB NOT NULL DEFAULT '{}',
    "price" DECIMAL(12,2) NOT NULL,
    "cost" DECIMAL(12,2),
    "inventory_qty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_daily_metrics" (
    "product_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "view_sessions" INTEGER NOT NULL DEFAULT 0,
    "cart_sessions" INTEGER NOT NULL DEFAULT 0,
    "purchase_sessions" INTEGER NOT NULL DEFAULT 0,
    "inventory_qty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_daily_metrics_pkey" PRIMARY KEY ("product_id","date")
);

-- CreateTable
CREATE TABLE "product_scores" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "money_at_stake" DECIMAL(14,2) NOT NULL,
    "sell_through" DECIMAL(6,4),
    "days_of_cover" DECIMAL(10,2),
    "trend" DECIMAL(10,4),

    CONSTRAINT "product_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnoses" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reasons" JSONB NOT NULL,
    "ai_summary" TEXT,
    "model_version" TEXT,

    CONSTRAINT "diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixes" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "diagnosis_id" TEXT,
    "type" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "applied_at" TIMESTAMP(3),

    CONSTRAINT "fixes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rescue_plans" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "fix_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "started_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "baseline" JSONB,
    "result" JSONB,
    "verdict" TEXT,

    CONSTRAINT "rescue_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "markdown_plans" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "rescue_plan_id" TEXT,
    "steps" JSONB NOT NULL,
    "floor_price" DECIMAL(12,2) NOT NULL,
    "max_discount_pct" DECIMAL(5,2) NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "markdown_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_changes" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "old_price" DECIMAL(12,2) NOT NULL,
    "new_price" DECIMAL(12,2) NOT NULL,
    "old_compare_at" DECIMAL(12,2),
    "new_compare_at" DECIMAL(12,2),
    "reason" TEXT NOT NULL,
    "plan_id" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "revenue_recovered" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "stock_value_cleared" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "products_rescued" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "product_id" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_state" (
    "shop_id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "last_cursor" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'idle',
    "error" TEXT,

    CONSTRAINT "sync_state_pkey" PRIMARY KEY ("shop_id","resource")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "shop_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(10,4) NOT NULL DEFAULT 0,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("shop_id","month")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_shop_key" ON "sessions"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "shops_domain_key" ON "shops"("domain");

-- CreateIndex
CREATE INDEX "products_shop_id_idx" ON "products"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_shop_id_shopify_gid_key" ON "products"("shop_id", "shopify_gid");

-- CreateIndex
CREATE UNIQUE INDEX "variants_product_id_shopify_gid_key" ON "variants"("product_id", "shopify_gid");

-- CreateIndex
CREATE INDEX "product_scores_product_id_computed_at_idx" ON "product_scores"("product_id", "computed_at");

-- CreateIndex
CREATE INDEX "price_changes_product_id_changed_at_idx" ON "price_changes"("product_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "reports_shop_id_period_key" ON "reports"("shop_id", "period");

-- CreateIndex
CREATE INDEX "notifications_shop_id_created_at_idx" ON "notifications"("shop_id", "created_at");

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variants" ADD CONSTRAINT "variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_daily_metrics" ADD CONSTRAINT "product_daily_metrics_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_scores" ADD CONSTRAINT "product_scores_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixes" ADD CONSTRAINT "fixes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixes" ADD CONSTRAINT "fixes_diagnosis_id_fkey" FOREIGN KEY ("diagnosis_id") REFERENCES "diagnoses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rescue_plans" ADD CONSTRAINT "rescue_plans_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markdown_plans" ADD CONSTRAINT "markdown_plans_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markdown_plans" ADD CONSTRAINT "markdown_plans_rescue_plan_id_fkey" FOREIGN KEY ("rescue_plan_id") REFERENCES "rescue_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Supabase exposes the public schema through its Data API. The app reaches the
-- database only through Prisma (postgres role, bypasses RLS), so enable RLS with
-- no policies to block all Data API access.
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shops" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "variants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_daily_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_scores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "diagnoses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fixes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rescue_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "markdown_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "price_changes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_state" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;
