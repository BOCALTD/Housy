-- Locking sign-in after wrong passwords: 3 wrong passwords lock for 4 hours, each later round 3 hours longer up to 22 hours,
-- then the account is closed until the platform team reviews it. Keyed by a hash of the email address, so a lock works the same
-- whether or not an account exists (the sign-in page never reveals which emails are registered).
CREATE TABLE "login_guards" (
    "key" TEXT NOT NULL,
    "user_id" TEXT,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "rounds" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "banned_at" TIMESTAMP(3),
    "last_failed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_guards_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "login_guards_user_id_idx" ON "login_guards"("user_id");
CREATE INDEX "login_guards_locked_until_idx" ON "login_guards"("locked_until");
ALTER TABLE "login_guards" ADD CONSTRAINT login_guards_state CHECK (
  key ~ '^[0-9a-f]{64}$' AND failed BETWEEN 0 AND 3 AND rounds BETWEEN 0 AND 20
);
-- Like rate_limits, this holds hashed keys and counters for sign-in, which happens before anyone is signed in, so it has no
-- row-level security; the app reads and writes it only through src/lib/services/login-guard.ts.
