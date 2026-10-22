-- CreateTable
CREATE TABLE "flatmate_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "display_name" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "areas" TEXT NOT NULL DEFAULT '',
    "budget_min_kobo" BIGINT NOT NULL,
    "budget_max_kobo" BIGINT NOT NULL,
    "move_in_from" DATE NOT NULL,
    "stay_months" INTEGER,
    "smoking" TEXT NOT NULL,
    "pets" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "tidiness" TEXT NOT NULL,
    "guests" TEXT NOT NULL,
    "household" TEXT NOT NULL DEFAULT 'ANY',
    "i_am" TEXT NOT NULL DEFAULT 'UNSAID',
    "occupation" TEXT NOT NULL DEFAULT '',
    "about" TEXT NOT NULL DEFAULT '',
    "room_listing_ref" TEXT NOT NULL DEFAULT '',
    "adult_confirmed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flatmate_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flatmate_interests" (
    "id" TEXT NOT NULL,
    "from_user_id" TEXT NOT NULL,
    "to_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flatmate_interests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flatmate_hides" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "hidden_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flatmate_hides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "flatmate_profiles_user_id_key" ON "flatmate_profiles"("user_id");
CREATE INDEX "flatmate_profiles_status_city_idx" ON "flatmate_profiles"("status", "city");
CREATE UNIQUE INDEX "flatmate_interests_from_user_id_to_user_id_key" ON "flatmate_interests"("from_user_id", "to_user_id");
CREATE INDEX "flatmate_interests_to_user_id_idx" ON "flatmate_interests"("to_user_id");
CREATE UNIQUE INDEX "flatmate_hides_user_id_hidden_user_id_key" ON "flatmate_hides"("user_id", "hidden_user_id");

ALTER TABLE "flatmate_profiles" ADD CONSTRAINT flatmate_profiles_values CHECK (
  status IN ('ACTIVE', 'PAUSED', 'SUSPENDED') AND mode IN ('HAS_ROOM', 'LOOKING', 'TEAM_UP')
  AND smoking IN ('NO', 'OUTSIDE', 'YES') AND pets IN ('NONE', 'HAS', 'OK') AND schedule IN ('EARLY', 'LATE', 'SHIFTS', 'FLEXIBLE')
  AND tidiness IN ('RELAXED', 'TIDY', 'VERY_TIDY') AND guests IN ('RARELY', 'SOMETIMES', 'OFTEN')
  AND household IN ('ANY', 'WOMEN', 'MEN') AND i_am IN ('UNSAID', 'WOMAN', 'MAN')
  AND char_length(display_name) BETWEEN 2 AND 40 AND char_length(city) BETWEEN 2 AND 80 AND char_length(areas) <= 300
  AND char_length(occupation) <= 80 AND char_length(about) <= 800 AND char_length(room_listing_ref) <= 40
  AND budget_min_kobo >= 0 AND budget_max_kobo > 0 AND budget_min_kobo <= budget_max_kobo
  AND (stay_months IS NULL OR stay_months BETWEEN 1 AND 60)
);
ALTER TABLE "flatmate_interests" ADD CONSTRAINT flatmate_interests_not_self CHECK (from_user_id <> to_user_id);
ALTER TABLE "flatmate_hides" ADD CONSTRAINT flatmate_hides_not_self CHECK (user_id <> hidden_user_id);

-- Whether a person has an active flatmate profile. SECURITY DEFINER so the profile policy can ask without looking at its own table through RLS.
CREATE OR REPLACE FUNCTION flatmate_active(uid text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM flatmate_profiles WHERE user_id = uid AND status = 'ACTIVE')
$$;
GRANT EXECUTE ON FUNCTION flatmate_active(text) TO PUBLIC;

-- Profiles: your own always; others' only while they are active and you have an active profile too. Never public.
-- Not FORCEd: flatmate_active() runs as the table owner and must see every row. The app role is still bound by these policies.
ALTER TABLE "flatmate_profiles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_profile ON "flatmate_profiles" FOR ALL USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user() AND status IN ('ACTIVE', 'PAUSED'));
CREATE POLICY members_read ON "flatmate_profiles" FOR SELECT USING (status = 'ACTIVE' AND app_current_user() IS NOT NULL AND flatmate_active(app_current_user()));
CREATE POLICY platform_admin ON "flatmate_profiles" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- Interests: you see ones you sent and ones sent to you; you can send only as yourself, and only to an active profile while yours is active.
ALTER TABLE "flatmate_interests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "flatmate_interests" FORCE ROW LEVEL SECURITY;
CREATE POLICY parties_read ON "flatmate_interests" FOR SELECT USING (from_user_id = app_current_user() OR to_user_id = app_current_user());
CREATE POLICY send ON "flatmate_interests" FOR INSERT WITH CHECK (from_user_id = app_current_user() AND flatmate_active(from_user_id) AND flatmate_active(to_user_id));
CREATE POLICY withdraw ON "flatmate_interests" FOR DELETE USING (from_user_id = app_current_user());
CREATE POLICY platform_admin ON "flatmate_interests" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "flatmate_hides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "flatmate_hides" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_hides ON "flatmate_hides" FOR ALL USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
