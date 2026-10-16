-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('ASSETS', 'LEASES');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('PREVIEWED', 'COMMITTED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('READY', 'DUPLICATE', 'ERROR', 'IMPORTED', 'FAILED');

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "file_name" TEXT NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'PREVIEWED',
    "note" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "committed_by_id" TEXT,
    "committed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "row_no" INTEGER NOT NULL,
    "status" "ImportRowStatus" NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL,
    "entity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "import_batches_company_id_ref_key" ON "import_batches"("company_id", "ref");

-- CreateIndex
CREATE INDEX "import_batches_company_id_created_at_idx" ON "import_batches"("company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_batch_id_row_no_key" ON "import_rows"("batch_id", "row_no");

-- CreateIndex
CREATE INDEX "import_rows_company_id_batch_id_status_idx" ON "import_rows"("company_id", "batch_id", "status");

ALTER TABLE "import_batches" ADD CONSTRAINT import_batches_state CHECK (char_length(file_name) BETWEEN 1 AND 200 AND char_length(note) <= 1000 AND (status = 'COMMITTED') = (committed_at IS NOT NULL AND committed_by_id IS NOT NULL));
ALTER TABLE "import_rows" ADD CONSTRAINT import_rows_state CHECK (row_no >= 2 AND char_length(message) <= 1000 AND (status IN ('IMPORTED')) = (entity_id IS NOT NULL));

ALTER TABLE "import_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_batches" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "import_batches" FOR ALL USING (company_id = app_current_company()) WITH CHECK (company_id = app_current_company());
ALTER TABLE "import_rows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_rows" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "import_rows" FOR ALL USING (company_id = app_current_company()) WITH CHECK (company_id = app_current_company());
