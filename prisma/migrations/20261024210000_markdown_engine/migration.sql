-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "markdown_end_action" TEXT NOT NULL DEFAULT 'restore';

-- AlterTable
ALTER TABLE "markdown_plans" ADD COLUMN     "current_step" INTEGER NOT NULL DEFAULT -1,
ADD COLUMN     "end_action" TEXT NOT NULL DEFAULT 'restore',
ADD COLUMN     "end_reason" TEXT,
ADD COLUMN     "start_stock" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "price_changes" ADD COLUMN     "error" TEXT,
ADD COLUMN     "floor_price" DECIMAL(12,2),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "variant_gid" TEXT;


-- Price floor enforced by the database too: a markdown can never be stored below its floor, and every
-- logged change with a floor respects it. Prices are written to Shopify only after this row is stored.
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_floor_check"
  CHECK (("reason" <> 'markdown' OR "floor_price" IS NOT NULL) AND ("floor_price" IS NULL OR "new_price" >= "floor_price"));

-- A plan always has a real (positive) floor.
ALTER TABLE "markdown_plans" ADD CONSTRAINT "markdown_plans_floor_positive" CHECK ("floor_price" > 0);

-- At most one running markdown plan per product (double clicks, two tabs).
CREATE UNIQUE INDEX "markdown_plans_one_running_per_product" ON "markdown_plans"("product_id") WHERE "status" IN ('active', 'paused');
