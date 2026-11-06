-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "page_builder" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "bought_together" TEXT[] DEFAULT ARRAY[]::TEXT[];
