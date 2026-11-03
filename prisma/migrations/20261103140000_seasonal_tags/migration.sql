-- AlterTable
ALTER TABLE "products" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "seasonal_collections" JSONB NOT NULL DEFAULT '[]';

