-- Incoming email: a private forwarding address per company, and received emails registered once each (by Message-ID).
-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "inbound_token" TEXT;

-- AlterTable
ALTER TABLE "correspondence" ADD COLUMN     "from_email" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "message_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "companies_inbound_token_key" ON "companies"("inbound_token");

-- CreateIndex
CREATE UNIQUE INDEX "correspondence_company_id_message_id_key" ON "correspondence"("company_id", "message_id");

