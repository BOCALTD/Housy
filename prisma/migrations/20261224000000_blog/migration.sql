-- The Housy blog: articles written by the platform team, public once published, with a cover picture for search results
-- and link previews. Anyone may read published posts; only the platform administrator writes.
CREATE TABLE "blog_posts" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "author_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "cover_type" TEXT,
    "cover_alt" TEXT NOT NULL DEFAULT '',
    "reading_minutes" INTEGER NOT NULL DEFAULT 1,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "blog_posts_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED'))
);
CREATE UNIQUE INDEX "blog_posts_slug_key" ON "blog_posts"("slug");
CREATE INDEX "blog_posts_status_published_at_idx" ON "blog_posts"("status", "published_at");

CREATE TABLE "blog_covers" (
    "post_id" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "blog_covers_pkey" PRIMARY KEY ("post_id"),
    CONSTRAINT "blog_covers_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "blog_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "blog_posts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "blog_posts" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_published ON "blog_posts" FOR SELECT USING ("status" = 'PUBLISHED' OR app_platform_admin());
CREATE POLICY admin_write ON "blog_posts" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
ALTER TABLE "blog_covers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "blog_covers" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_published ON "blog_covers" FOR SELECT USING (EXISTS (SELECT 1 FROM blog_posts p WHERE p.id = post_id AND (p.status = 'PUBLISHED' OR app_platform_admin())));
CREATE POLICY admin_write ON "blog_covers" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
