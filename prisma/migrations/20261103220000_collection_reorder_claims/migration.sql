-- AlterTable
ALTER TABLE "collection_reorders" ADD COLUMN     "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- At most one save or undo running per collection (double clicks, two tabs), enforced by the database.
CREATE UNIQUE INDEX "collection_reorders_one_change_per_collection" ON "collection_reorders"("shop_id", "collection_gid") WHERE "status" IN ('applying', 'undoing');
