-- The public browse page lists published listings newest first. Row-level security wraps every public read in a rule that stops the database
-- using an index that starts with the status, so the index is on the publish date alone. With it the page reads 60 rows instead of sorting
-- every published listing (measured as the app's own role on 60,000 listings: 25.7 ms down to 0.13 ms).
CREATE INDEX "listings_published_at_idx" ON "listings"("published_at" DESC);
