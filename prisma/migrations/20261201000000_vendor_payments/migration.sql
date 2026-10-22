-- AlterTable
ALTER TABLE "vendor_submissions" ADD COLUMN     "paid_amount_kobo" BIGINT,
ADD COLUMN     "paid_by_id" TEXT,
ADD COLUMN     "paid_on" DATE,
ADD COLUMN     "paid_reference" TEXT NOT NULL DEFAULT '';

-- Only an accepted invoice can be marked paid, and a payment has a positive amount and who recorded it.
ALTER TABLE "vendor_submissions" ADD CONSTRAINT vendor_submissions_paid CHECK (
  (paid_on IS NULL AND paid_amount_kobo IS NULL AND paid_by_id IS NULL AND paid_reference = '')
  OR (paid_on IS NOT NULL AND kind = 'INVOICE' AND status = 'ACCEPTED' AND paid_amount_kobo > 0 AND paid_by_id IS NOT NULL AND char_length(paid_reference) <= 120)
);

-- A vendor can never send a submission that already claims to be paid.
DROP POLICY vendor_submit ON "vendor_submissions";
CREATE POLICY vendor_submit ON "vendor_submissions" FOR INSERT WITH CHECK (user_id = app_current_user() AND status = 'SUBMITTED' AND decided_by_id IS NULL AND paid_on IS NULL
  AND EXISTS (SELECT 1 FROM portal_grants g WHERE g.id = grant_id AND g.user_id = app_current_user() AND g.status = 'ACTIVE' AND g.kind = 'VENDOR' AND g.company_id = vendor_submissions.company_id));
