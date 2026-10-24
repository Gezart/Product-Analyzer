-- AlterTable
ALTER TABLE "product_scores" ADD COLUMN     "cost_is_estimate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stock_value" DECIMAL(14,2) NOT NULL DEFAULT 0;

