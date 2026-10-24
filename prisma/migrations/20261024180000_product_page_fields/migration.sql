-- AlterTable
ALTER TABLE "products" ADD COLUMN     "description" TEXT,
ADD COLUMN     "seo_description" TEXT,
ADD COLUMN     "seo_title" TEXT;

-- AlterTable
ALTER TABLE "variants" ADD COLUMN     "sells_when_out" BOOLEAN NOT NULL DEFAULT false;

