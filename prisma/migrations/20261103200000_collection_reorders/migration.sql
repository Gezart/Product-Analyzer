-- CreateTable
CREATE TABLE "collection_reorders" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "collection_gid" TEXT NOT NULL,
    "collection_title" TEXT NOT NULL,
    "before" TEXT[],
    "after" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'applying',
    "error" TEXT,
    "applied_at" TIMESTAMP(3),
    "undone_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_reorders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "collection_reorders_shop_id_collection_gid_created_at_idx" ON "collection_reorders"("shop_id", "collection_gid", "created_at");

-- AddForeignKey
ALTER TABLE "collection_reorders" ADD CONSTRAINT "collection_reorders_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row level security: the app connects as the table owner; nothing is exposed through the Data API.
ALTER TABLE "collection_reorders" ENABLE ROW LEVEL SECURITY;
