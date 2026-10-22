-- CreateTable
CREATE TABLE "inspection_bookings" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "requester_name" TEXT NOT NULL,
    "requester_phone" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL DEFAULT '',
    "preferred_at" TIMESTAMP(3) NOT NULL,
    "alternative_at" TIMESTAMP(3),
    "scheduled_at" TIMESTAMP(3),
    "duration_minutes" INTEGER NOT NULL DEFAULT 60,
    "assigned_user_id" TEXT,
    "meeting_point" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "cancel_reason" TEXT NOT NULL DEFAULT '',
    "outcome" TEXT NOT NULL DEFAULT '',
    "reschedule_count" INTEGER NOT NULL DEFAULT 0,
    "reminded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_booking_events" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "from_status" TEXT NOT NULL,
    "to_status" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_booking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_sessions" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "company_id" TEXT,
    "share_token_hash" TEXT,
    "trusted_name" TEXT NOT NULL DEFAULT '',
    "trusted_phone" TEXT NOT NULL DEFAULT '',
    "trusted_email" TEXT NOT NULL DEFAULT '',
    "consent_version" TEXT NOT NULL,
    "consent_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expected_end_at" TIMESTAMP(3) NOT NULL,
    "checked_in_at" TIMESTAMP(3),
    "checked_out_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "end_reason" TEXT NOT NULL DEFAULT '',
    "emergency_at" TIMESTAMP(3),
    "emergency_note" TEXT NOT NULL DEFAULT '',
    "last_lat" DOUBLE PRECISION,
    "last_lng" DOUBLE PRECISION,
    "last_at" TIMESTAMP(3),

    CONSTRAINT "safety_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_pings" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "company_id" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safety_pings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_cases" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "target_kind" TEXT NOT NULL DEFAULT 'OTHER',
    "target_ref" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL,
    "assigned_to_id" TEXT,
    "due_at" TIMESTAMP(3) NOT NULL,
    "outcome_for_reporter" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "trust_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_case_evidence" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trust_case_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_case_events" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "to_reporter" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trust_case_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inspection_bookings_ref_key" ON "inspection_bookings"("ref");
CREATE INDEX "inspection_bookings_company_id_scheduled_at_idx" ON "inspection_bookings"("company_id", "scheduled_at");
CREATE INDEX "inspection_bookings_requester_id_idx" ON "inspection_bookings"("requester_id");
CREATE INDEX "inspection_bookings_assigned_user_id_scheduled_at_idx" ON "inspection_bookings"("assigned_user_id", "scheduled_at");
CREATE INDEX "inspection_booking_events_booking_id_created_at_idx" ON "inspection_booking_events"("booking_id", "created_at");
CREATE UNIQUE INDEX "safety_sessions_share_token_hash_key" ON "safety_sessions"("share_token_hash");
CREATE INDEX "safety_sessions_user_id_started_at_idx" ON "safety_sessions"("user_id", "started_at");
CREATE INDEX "safety_sessions_company_id_started_at_idx" ON "safety_sessions"("company_id", "started_at");
CREATE INDEX "safety_sessions_booking_id_idx" ON "safety_sessions"("booking_id");
CREATE INDEX "safety_pings_session_id_at_idx" ON "safety_pings"("session_id", "at");
CREATE UNIQUE INDEX "trust_cases_ref_key" ON "trust_cases"("ref");
CREATE INDEX "trust_cases_status_due_at_idx" ON "trust_cases"("status", "due_at");
CREATE INDEX "trust_cases_reporter_id_idx" ON "trust_cases"("reporter_id");
CREATE INDEX "trust_case_evidence_case_id_idx" ON "trust_case_evidence"("case_id");
CREATE INDEX "trust_case_events_case_id_created_at_idx" ON "trust_case_events"("case_id", "created_at");

-- Rules
ALTER TABLE "inspection_bookings" ADD CONSTRAINT inspection_bookings_state CHECK (
  status IN ('REQUESTED', 'CONFIRMED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'RESCHEDULED')
  AND duration_minutes BETWEEN 15 AND 480
  AND char_length(requester_name) BETWEEN 2 AND 120 AND char_length(requester_phone) <= 30 AND char_length(message) <= 1000
  AND char_length(meeting_point) <= 300 AND char_length(cancel_reason) <= 500 AND char_length(outcome) <= 1000
  AND (status IN ('REQUESTED', 'CANCELLED') OR scheduled_at IS NOT NULL)
);
ALTER TABLE "safety_sessions" ADD CONSTRAINT safety_sessions_state CHECK (
  expected_end_at > started_at AND char_length(trusted_name) <= 120 AND char_length(trusted_phone) <= 30 AND char_length(trusted_email) <= 160
  AND char_length(emergency_note) <= 500 AND end_reason IN ('', 'CHECKED_OUT', 'STOPPED', 'AUTO_STOPPED')
  AND (last_lat IS NULL OR last_lat BETWEEN -90 AND 90) AND (last_lng IS NULL OR last_lng BETWEEN -180 AND 180)
);
ALTER TABLE "safety_pings" ADD CONSTRAINT safety_pings_state CHECK (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180 AND (accuracy IS NULL OR accuracy BETWEEN 0 AND 100000));
ALTER TABLE "trust_cases" ADD CONSTRAINT trust_cases_state CHECK (
  category IN ('SUSPICIOUS_LISTING', 'FRAUD', 'IDENTITY', 'REVIEW_DISPUTE', 'INSPECTION_SAFETY', 'HARASSMENT', 'VACANCY_REPORT', 'UNAUTHORISED_CONTENT', 'COLLABORATION', 'SECURITY_INCIDENT', 'APPEAL', 'OTHER')
  AND severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
  AND status IN ('OPEN', 'INVESTIGATING', 'WAITING_INFO', 'ACTION_TAKEN', 'CLOSED_NO_ACTION')
  AND target_kind IN ('LISTING', 'COMPANY', 'AGENT', 'USER', 'REVIEW', 'REEL', 'BOOKING', 'VACANCY', 'COLLABORATION', 'OTHER')
  AND char_length(target_ref) <= 200 AND char_length(description) BETWEEN 10 AND 5000 AND char_length(outcome_for_reporter) <= 2000
);
ALTER TABLE "trust_case_evidence" ADD CONSTRAINT trust_case_evidence_state CHECK (mime_type IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp') AND octet_length(bytes) BETWEEN 1 AND 4194304 AND char_length(name) <= 200);
ALTER TABLE "trust_case_events" ADD CONSTRAINT trust_case_events_state CHECK (kind IN ('NOTE', 'STATUS', 'SEVERITY', 'ASSIGN', 'ACTION', 'MESSAGE', 'REPLY') AND char_length(body) <= 5000);

-- Bookings: the company sees its own; the person who asked sees theirs and can only create a request or cancel it.
ALTER TABLE "inspection_bookings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inspection_bookings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "inspection_bookings" FOR ALL USING (company_id = app_current_company()) WITH CHECK (company_id = app_current_company());
CREATE POLICY requester_read ON "inspection_bookings" FOR SELECT USING (requester_id = app_current_user());
CREATE POLICY requester_create ON "inspection_bookings" FOR INSERT WITH CHECK (requester_id = app_current_user() AND status = 'REQUESTED' AND scheduled_at IS NULL AND assigned_user_id IS NULL
  AND EXISTS (SELECT 1 FROM listings l WHERE l.id = listing_id AND l.company_id = inspection_bookings.company_id AND l.status = 'PUBLISHED'));
CREATE POLICY requester_cancel ON "inspection_bookings" FOR UPDATE USING (requester_id = app_current_user()) WITH CHECK (requester_id = app_current_user() AND status = 'CANCELLED');
CREATE POLICY platform_admin_read ON "inspection_bookings" FOR SELECT USING (app_platform_admin());

ALTER TABLE "inspection_booking_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inspection_booking_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "inspection_booking_events" FOR ALL USING (company_id = app_current_company()) WITH CHECK (company_id = app_current_company());
CREATE POLICY requester_read ON "inspection_booking_events" FOR SELECT USING (requester_id = app_current_user());
CREATE POLICY requester_write ON "inspection_booking_events" FOR INSERT WITH CHECK (requester_id = app_current_user() AND actor_id = app_current_user());
CREATE POLICY platform_admin_read ON "inspection_booking_events" FOR SELECT USING (app_platform_admin());

-- Safety: the person tracked owns the session. Their company (only when they attend for that company) can read it, a trusted contact can
-- read it with the private link while it is on, and platform administrators can read it. Nobody else.
ALTER TABLE "safety_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "safety_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_session ON "safety_sessions" FOR ALL USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
CREATE POLICY company_read ON "safety_sessions" FOR SELECT USING (company_id = app_current_company());
CREATE POLICY trusted_link ON "safety_sessions" FOR SELECT USING (share_token_hash = app_invite_token());
CREATE POLICY platform_admin_read ON "safety_sessions" FOR SELECT USING (app_platform_admin());
CREATE POLICY platform_admin_update ON "safety_sessions" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "safety_pings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "safety_pings" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_pings ON "safety_pings" FOR ALL USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
CREATE POLICY company_read ON "safety_pings" FOR SELECT USING (company_id = app_current_company());
CREATE POLICY trusted_link ON "safety_pings" FOR SELECT USING (EXISTS (SELECT 1 FROM safety_sessions s WHERE s.id = safety_pings.session_id AND s.share_token_hash = app_invite_token()));
CREATE POLICY platform_admin ON "safety_pings" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- Trust and Safety cases are platform records: the reporter sees their own case and the lines meant for them; reviewers see everything.
ALTER TABLE "trust_cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trust_cases" FORCE ROW LEVEL SECURITY;
CREATE POLICY reporter_read ON "trust_cases" FOR SELECT USING (reporter_id = app_current_user());
CREATE POLICY reporter_create ON "trust_cases" FOR INSERT WITH CHECK (reporter_id = app_current_user() AND status = 'OPEN' AND assigned_to_id IS NULL);
CREATE POLICY platform_admin ON "trust_cases" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "trust_case_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trust_case_evidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY reporter_own ON "trust_case_evidence" FOR SELECT USING (reporter_id = app_current_user());
CREATE POLICY reporter_add ON "trust_case_evidence" FOR INSERT WITH CHECK (reporter_id = app_current_user());
CREATE POLICY platform_admin ON "trust_case_evidence" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "trust_case_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trust_case_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY reporter_read ON "trust_case_events" FOR SELECT USING (reporter_id = app_current_user() AND to_reporter);
CREATE POLICY reporter_reply ON "trust_case_events" FOR INSERT WITH CHECK (reporter_id = app_current_user() AND actor_id = app_current_user() AND kind = 'REPLY' AND to_reporter);
CREATE POLICY platform_admin ON "trust_case_events" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
