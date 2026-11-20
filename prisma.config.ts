/**
 * Prisma's command-line settings (Prisma 7 reads connection strings from here, not from the schema).
 * Every script that runs Prisma sets DATABASE_URL in the environment first: deploy.sh and job.sh load /etc/housy/housy.env,
 * scripts/ubuntu-local.sh loads .env, db-setup.mjs and db:migrate pass the owner's connection. A local .env is read too when
 * present, without overriding anything already set. Commands that do not touch a database (generate, validate) need none of it.
 */
import { defineConfig } from "prisma/config";

try { process.loadEnvFile(".env"); } catch { /* no .env here: the environment already holds the settings */ }

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
    ...(process.env.SHADOW_DATABASE_URL ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL } : {}),
  },
});
