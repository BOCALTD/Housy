-- AlterTable
ALTER TABLE "users" ADD COLUMN     "legal_accepted" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "legal_page_versions" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "change_note" TEXT NOT NULL DEFAULT '',
    "material" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "effective_from" DATE,
    "created_by_id" TEXT NOT NULL,
    "published_by_id" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_page_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_page_versions_slug_status_idx" ON "legal_page_versions"("slug", "status");

-- CreateIndex
CREATE UNIQUE INDEX "legal_page_versions_slug_version_key" ON "legal_page_versions"("slug", "version");


ALTER TABLE "legal_page_versions" ADD CONSTRAINT legal_page_status CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED', 'WITHDRAWN'));
ALTER TABLE "legal_page_versions" ADD CONSTRAINT legal_page_slug CHECK (slug ~ '^[a-z][a-z0-9-]{1,40}$' AND version >= 1);
ALTER TABLE "legal_page_versions" ADD CONSTRAINT legal_page_published CHECK (status = 'DRAFT' OR (published_at IS NOT NULL AND published_by_id IS NOT NULL));
-- One draft per page at a time.
CREATE UNIQUE INDEX legal_page_one_draft ON "legal_page_versions"(slug) WHERE status = 'DRAFT';

ALTER TABLE "legal_page_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "legal_page_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY public_read ON "legal_page_versions" FOR SELECT USING (status IN ('PUBLISHED', 'RETIRED') OR app_platform_admin());
CREATE POLICY admin_write ON "legal_page_versions" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- What was published is never rewritten: only its status moves on (replaced, or withdrawn before it took effect).
CREATE FUNCTION legal_page_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'A published legal page cannot be deleted' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'DRAFT' THEN
    IF (to_jsonb(NEW) - 'status' - 'updated_at') <> (to_jsonb(OLD) - 'status' - 'updated_at')
       OR NOT ((OLD.status = 'PUBLISHED' AND NEW.status IN ('PUBLISHED', 'RETIRED', 'WITHDRAWN')) OR NEW.status = OLD.status) THEN
      RAISE EXCEPTION 'A published legal page cannot be changed; write a new version' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER legal_page_fixed BEFORE UPDATE OR DELETE ON legal_page_versions FOR EACH ROW EXECUTE FUNCTION legal_page_fixed();
