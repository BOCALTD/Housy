-- Document contents stored in the database (serverless hosts such as Vercel have no permanent disk).

-- CreateTable
CREATE TABLE "stored_files" (
    "key" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "stored_files_company_id_idx" ON "stored_files"("company_id");

ALTER TABLE stored_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE stored_files FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stored_files FOR ALL
  USING (company_id = app_current_company()) WITH CHECK (company_id = app_current_company());
