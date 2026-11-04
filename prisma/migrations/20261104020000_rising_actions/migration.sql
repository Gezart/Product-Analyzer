-- CreateTable
CREATE TABLE "rising_actions" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "started_on" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rising_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rising_actions_product_id_started_on_idx" ON "rising_actions"("product_id", "started_on");

-- AddForeignKey
ALTER TABLE "rising_actions" ADD CONSTRAINT "rising_actions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row level security: the app connects as the table owner; nothing is exposed through the Data API.
ALTER TABLE "rising_actions" ENABLE ROW LEVEL SECURITY;
