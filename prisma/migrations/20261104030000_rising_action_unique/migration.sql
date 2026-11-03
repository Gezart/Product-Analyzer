-- AlterTable
ALTER TABLE "rising_actions" ADD COLUMN     "reorder_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "rising_actions_product_id_kind_started_on_key" ON "rising_actions"("product_id", "kind", "started_on");

