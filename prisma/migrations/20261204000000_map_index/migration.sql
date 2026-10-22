-- CreateIndex
CREATE INDEX "listings_status_lat_lng_idx" ON "listings"("status", "lat", "lng");
