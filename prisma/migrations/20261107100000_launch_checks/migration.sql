-- CreateTable
CREATE TABLE "launch_checks" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "launch_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "launch_checks_product_id_day_key" ON "launch_checks"("product_id", "day");

-- AddForeignKey
ALTER TABLE "launch_checks" ADD CONSTRAINT "launch_checks_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row level security: the app connects as the table owner; nothing is exposed through the Data API.
ALTER TABLE "launch_checks" ENABLE ROW LEVEL SECURITY;
