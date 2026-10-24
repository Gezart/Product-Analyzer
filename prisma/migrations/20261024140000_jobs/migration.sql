-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "unique_key" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jobs_unique_key_key" ON "jobs"("unique_key");

-- CreateIndex
CREATE INDEX "jobs_status_run_at_idx" ON "jobs"("status", "run_at");

-- CreateIndex
CREATE INDEX "jobs_shop_id_status_idx" ON "jobs"("shop_id", "status");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Block Supabase Data API access (app uses Prisma only).
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;

-- At most one running job per shop (enforced by the database, see src/lib/jobs/queue.ts).
CREATE UNIQUE INDEX "jobs_one_running_per_shop" ON "jobs"("shop_id") WHERE "status" = 'running';
