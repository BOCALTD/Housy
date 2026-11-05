-- Find an account by its phone number (international form), to offer a client their company's artisans when the client's
-- record has a phone but no email that matches an account.
CREATE INDEX "users_phone_idx" ON "users"("phone");
