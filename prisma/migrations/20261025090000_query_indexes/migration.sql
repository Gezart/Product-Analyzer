-- CreateIndex
CREATE INDEX "diagnoses_product_id_created_at_idx" ON "diagnoses"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "markdown_plans_product_id_started_at_idx" ON "markdown_plans"("product_id", "started_at");

-- CreateIndex
CREATE INDEX "price_changes_plan_id_status_idx" ON "price_changes"("plan_id", "status");
