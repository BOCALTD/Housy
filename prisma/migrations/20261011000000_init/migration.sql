-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('COMPANY_SUPER_ADMIN', 'MANAGER', 'AGENT', 'OFFICER', 'VIEWER');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AssetClass" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'LAND', 'INDUSTRIAL', 'PLANT_MACHINERY', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'VACANT', 'OCCUPIED', 'UNDER_RENOVATION', 'DISPOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CompanyRelationship" AS ENUM ('OWNER', 'MANAGER', 'CUSTODIAN', 'LISTING_AGENT');

-- CreateEnum
CREATE TYPE "PartyRelationship" AS ENUM ('LEGAL_OWNER', 'BENEFICIAL_OWNER', 'PROPERTY_MANAGER', 'CUSTODIAN', 'LESSEE', 'LISTING_AGENT', 'MAINTENANCE_RESPONSIBLE', 'INCOME_COLLECTOR');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('TITLE_OWNERSHIP', 'LEASE_AGREEMENT', 'MANAGEMENT_AGREEMENT', 'SURVEY_PLAN', 'VALUATION_REPORT', 'INSPECTION_REPORT', 'INSURANCE', 'TAX_RECEIPT', 'PERMIT_APPROVAL', 'CORRESPONDENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "RentFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "LeaseStatus" AS ENUM ('ACTIVE', 'ENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('TASK', 'INSPECTION', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ListingPurpose" AS ENUM ('SALE', 'RENT', 'LEASE');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'UNAVAILABLE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PlacementLabel" AS ENUM ('SPONSORED', 'AFFILIATED', 'EDITORIAL');

-- CreateEnum
CREATE TYPE "RecommendationEventType" AS ENUM ('IMPRESSION', 'CONFIRMED_INTEREST', 'DECLINED', 'LATER');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('SUBMITTED', 'CONTACTED', 'IN_PROGRESS', 'CLOSED', 'WITHDRAWN', 'DECLINED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_platform_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "company_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'VIEWER',
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "asset_class" "AssetClass" NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT '',
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "company_relationship" "CompanyRelationship" NOT NULL,
    "acquisition_cost_kobo" BIGINT,
    "acquired_on" DATE,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_parties" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "party_name" TEXT NOT NULL,
    "relationship" "PartyRelationship" NOT NULL,
    "effective_from" DATE,
    "effective_to" DATE,
    "evidence_note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_documents" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "expires_on" DATE,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leases" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "occupant_name" TEXT NOT NULL,
    "occupant_contact" TEXT NOT NULL DEFAULT '',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "rent_kobo" BIGINT NOT NULL,
    "frequency" "RentFrequency" NOT NULL,
    "deposit_kobo" BIGINT NOT NULL DEFAULT 0,
    "status" "LeaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rent_charges" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "lease_id" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "paid_kobo" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "rent_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rent_payments" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "charge_id" TEXT NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "paid_on" DATE NOT NULL,
    "evidence" TEXT NOT NULL,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rent_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "kind" "TaskKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "assignee_id" TEXT,
    "due_on" DATE,
    "outcome" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_log" (
    "id" TEXT NOT NULL,
    "company_id" TEXT,
    "actor_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "public_ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "purpose" "ListingPurpose" NOT NULL,
    "price_kobo" BIGINT NOT NULL,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "description" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "review_note" TEXT NOT NULL DEFAULT '',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enquiries" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT NOT NULL,
    "profile" TEXT NOT NULL DEFAULT '',
    "services" TEXT NOT NULL DEFAULT '',
    "coverage" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "status" "ProviderStatus" NOT NULL DEFAULT 'PENDING',
    "placement" "PlacementLabel" NOT NULL DEFAULT 'EDITORIAL',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_events" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "listing_ref" TEXT NOT NULL,
    "user_id" TEXT,
    "visitor_key" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "modal_version" TEXT NOT NULL,
    "event" "RecommendationEventType" NOT NULL,
    "preselected" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_leads" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "access_token_hash" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "listing_ref" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "contact_method" TEXT NOT NULL,
    "contact_value" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "consent_text_version" TEXT NOT NULL,
    "consent_given_at" TIMESTAMP(3) NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'SUBMITTED',
    "withdrawn_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_company_id_user_id_key" ON "memberships"("company_id", "user_id");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_company_id_idx" ON "invitations"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "assets_company_id_ref_key" ON "assets"("company_id", "ref");

-- CreateIndex
CREATE INDEX "assets_company_id_status_idx" ON "assets"("company_id", "status");

-- CreateIndex
CREATE INDEX "asset_parties_company_id_asset_id_idx" ON "asset_parties"("company_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_documents_storage_key_key" ON "asset_documents"("storage_key");

-- CreateIndex
CREATE INDEX "asset_documents_company_id_asset_id_idx" ON "asset_documents"("company_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "leases_company_id_ref_key" ON "leases"("company_id", "ref");

-- CreateIndex
CREATE INDEX "leases_company_id_asset_id_idx" ON "leases"("company_id", "asset_id");

-- CreateIndex
CREATE INDEX "rent_charges_company_id_due_date_idx" ON "rent_charges"("company_id", "due_date");

-- CreateIndex
CREATE INDEX "rent_charges_lease_id_idx" ON "rent_charges"("lease_id");

-- CreateIndex
CREATE INDEX "rent_payments_charge_id_idx" ON "rent_payments"("charge_id");

-- CreateIndex
CREATE INDEX "tasks_company_id_status_idx" ON "tasks"("company_id", "status");

-- CreateIndex
CREATE INDEX "tasks_asset_id_idx" ON "tasks"("asset_id");

-- CreateIndex
CREATE INDEX "activity_log_company_id_entity_type_entity_id_idx" ON "activity_log"("company_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "activity_log_company_id_created_at_idx" ON "activity_log"("company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "listings_asset_id_key" ON "listings"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "listings_public_ref_key" ON "listings"("public_ref");

-- CreateIndex
CREATE INDEX "listings_status_city_idx" ON "listings"("status", "city");

-- CreateIndex
CREATE INDEX "enquiries_company_id_created_at_idx" ON "enquiries"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "recommendation_events_provider_id_event_idx" ON "recommendation_events"("provider_id", "event");

-- CreateIndex
CREATE UNIQUE INDEX "provider_leads_ref_key" ON "provider_leads"("ref");

-- CreateIndex
CREATE INDEX "provider_leads_provider_id_status_idx" ON "provider_leads"("provider_id", "status");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_parties" ADD CONSTRAINT "asset_parties_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_documents" ADD CONSTRAINT "asset_documents_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_charges" ADD CONSTRAINT "rent_charges_lease_id_fkey" FOREIGN KEY ("lease_id") REFERENCES "leases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_payments" ADD CONSTRAINT "rent_payments_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "rent_charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_events" ADD CONSTRAINT "recommendation_events_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "service_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_leads" ADD CONSTRAINT "provider_leads_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "service_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

