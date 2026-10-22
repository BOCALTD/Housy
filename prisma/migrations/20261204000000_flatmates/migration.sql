-- CreateTable
CREATE TABLE "flatmate_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "display_name" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'NG',
    "city" TEXT NOT NULL,
    "areas" TEXT NOT NULL DEFAULT '',
    "budget_min_kobo" BIGINT NOT NULL,
    "budget_max_kobo" BIGINT NOT NULL,
    "move_in_from" DATE NOT NULL,
    "stay_months" INTEGER,
    "age_band" TEXT NOT NULL,
    "age_pref" TEXT NOT NULL DEFAULT 'ANY',
    "gender" TEXT NOT NULL DEFAULT 'UNSAID',
    "gender_pref" TEXT NOT NULL DEFAULT 'ANY',
    "show_gender" BOOLEAN NOT NULL DEFAULT false,
    "answers" JSONB NOT NULL,
    "must_match" TEXT NOT NULL DEFAULT '',
    "occupation" TEXT NOT NULL DEFAULT '',
    "about" TEXT NOT NULL DEFAULT '',
    "room_listing_ref" TEXT NOT NULL DEFAULT '',
    "adult_confirmed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flatmate_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flatmate_requests" (
    "id" TEXT NOT NULL,
    "from_user_id" TEXT NOT NULL,
    "to_user_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "room_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "flatmate_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flatmate_rooms" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flatmate_rooms_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "flatmate_profiles_status_country_city_idx" ON "flatmate_profiles"("status", "country", "city");
CREATE UNIQUE INDEX "flatmate_requests_from_user_id_to_user_id_key" ON "flatmate_requests"("from_user_id", "to_user_id");
CREATE INDEX "flatmate_requests_to_user_id_status_idx" ON "flatmate_requests"("to_user_id", "status");
CREATE UNIQUE INDEX "flatmate_rooms_conversation_id_key" ON "flatmate_rooms"("conversation_id");
CREATE UNIQUE INDEX "flatmate_hides_user_id_hidden_user_id_key" ON "flatmate_hides"("user_id", "hidden_user_id");

-- AddForeignKey
ALTER TABLE "flatmate_rooms" ADD CONSTRAINT "flatmate_rooms_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "flatmate_profiles" ADD CONSTRAINT flatmate_profiles_values CHECK (
  status IN ('ACTIVE', 'PAUSED', 'SUSPENDED') AND intent IN ('HAVE_ROOM', 'NEED_ROOM', 'TEAM_UP')
  AND age_band IN ('18-24', '25-34', '35-44', '45-59', '60+') AND age_pref IN ('ANY', 'SIMILAR')
  AND gender IN ('WOMAN', 'MAN', 'NON_BINARY', 'UNSAID') AND gender_pref IN ('ANY', 'WOMEN', 'MEN', 'SAME')
  AND country ~ '^[A-Z]{2}$' AND jsonb_typeof(answers) = 'object' AND char_length(must_match) <= 120
  AND char_length(display_name) BETWEEN 2 AND 40 AND char_length(city) BETWEEN 2 AND 80 AND char_length(areas) <= 300
  AND char_length(occupation) <= 80 AND char_length(about) <= 800 AND char_length(room_listing_ref) <= 40
  AND budget_min_kobo >= 0 AND budget_max_kobo > 0 AND budget_min_kobo <= budget_max_kobo
  AND (stay_months IS NULL OR stay_months BETWEEN 1 AND 60)
);
ALTER TABLE "flatmate_requests" ADD CONSTRAINT flatmate_requests_values CHECK (
  from_user_id <> to_user_id AND status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'ENDED') AND score BETWEEN 0 AND 100 AND char_length(note) <= 300
);
ALTER TABLE "flatmate_rooms" ADD CONSTRAINT flatmate_rooms_status CHECK (status IN ('OPEN', 'CLOSED'));
ALTER TABLE "flatmate_hides" ADD CONSTRAINT flatmate_hides_not_self CHECK (user_id <> hidden_user_id);

-- Whether a person has an active flatmate profile, and whether two people are matched. SECURITY DEFINER so policies can ask
-- without looking at these tables through row-level security.
CREATE OR REPLACE FUNCTION flatmate_active(uid text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM flatmate_profiles WHERE user_id = uid AND status = 'ACTIVE')
$$;
CREATE OR REPLACE FUNCTION flatmate_matched(a text, b text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM flatmate_requests WHERE status = 'ACCEPTED' AND ((from_user_id = a AND to_user_id = b) OR (from_user_id = b AND to_user_id = a)))
$$;
CREATE OR REPLACE FUNCTION flatmate_room_open(cid text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM flatmate_rooms WHERE conversation_id = cid AND status = 'OPEN')
$$;
GRANT EXECUTE ON FUNCTION flatmate_active(text), flatmate_matched(text, text), flatmate_room_open(text) TO PUBLIC;

-- Profiles: your own always; others' only while they are active and you have an active profile too. Never public.
-- Not FORCEd: flatmate_active() runs as the table owner and must see every row. The app role is still bound by these policies.
ALTER TABLE "flatmate_profiles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_profile ON "flatmate_profiles" FOR ALL USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user() AND status IN ('ACTIVE', 'PAUSED'));
CREATE POLICY members_read ON "flatmate_profiles" FOR SELECT USING (status = 'ACTIVE' AND app_current_user() IS NOT NULL AND flatmate_active(app_current_user()));
CREATE POLICY platform_admin ON "flatmate_profiles" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- Requests: the two people see them; only the sender creates one (while both profiles are active); either side moves it on.
ALTER TABLE "flatmate_requests" ENABLE ROW LEVEL SECURITY;
CREATE POLICY parties_read ON "flatmate_requests" FOR SELECT USING (from_user_id = app_current_user() OR to_user_id = app_current_user());
CREATE POLICY send ON "flatmate_requests" FOR INSERT WITH CHECK (from_user_id = app_current_user() AND status = 'PENDING' AND room_id IS NULL AND flatmate_active(from_user_id) AND flatmate_active(to_user_id));
CREATE POLICY parties_update ON "flatmate_requests" FOR UPDATE USING (from_user_id = app_current_user() OR to_user_id = app_current_user()) WITH CHECK (from_user_id = app_current_user() OR to_user_id = app_current_user());
CREATE POLICY platform_admin ON "flatmate_requests" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- Rooms: their members see them; the person accepting a match creates one; members can close it.
ALTER TABLE "flatmate_rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "flatmate_rooms" FORCE ROW LEVEL SECURITY;
CREATE POLICY members_read ON "flatmate_rooms" FOR SELECT USING (conv_member(conversation_id) OR created_by_id = app_current_user());
CREATE POLICY creator_insert ON "flatmate_rooms" FOR INSERT WITH CHECK (created_by_id = app_current_user() AND status = 'OPEN');
CREATE POLICY members_update ON "flatmate_rooms" FOR UPDATE USING (conv_member(conversation_id)) WITH CHECK (conv_member(conversation_id));

-- Room membership: a member of an open room may add someone they are matched with; anyone may leave a room.
CREATE POLICY room_add_member ON "conversation_members" FOR INSERT WITH CHECK (flatmate_room_open(conversation_id) AND conv_member(conversation_id) AND flatmate_matched(app_current_user(), user_id));
CREATE POLICY room_leave ON "conversation_members" FOR DELETE USING (user_id = app_current_user() AND EXISTS (SELECT 1 FROM flatmate_rooms r WHERE r.conversation_id = conversation_members.conversation_id));

ALTER TABLE "flatmate_hides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "flatmate_hides" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_hides ON "flatmate_hides" FOR ALL USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
