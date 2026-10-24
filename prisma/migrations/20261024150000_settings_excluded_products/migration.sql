-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "excluded_product_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

