-- A bundle's Shopify discount ends by itself unless the hourly check pushes it forward.
ALTER TABLE "bundles" ADD COLUMN "ends_at" TIMESTAMP(3);
