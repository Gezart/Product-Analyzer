-- AlterTable
ALTER TABLE "fixes" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "error" TEXT,
ADD COLUMN     "undone_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "fixes_product_id_created_at_idx" ON "fixes"("product_id", "created_at");

