import { timingSafeEqual } from "node:crypto";

/** Scheduled jobs call with `Authorization: Bearer $CRON_SECRET`. Without the secret set, nobody can run them. */
export function cronAuthorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret ?? ""}`;
  return !!secret && given.length === want.length && timingSafeEqual(Buffer.from(given), Buffer.from(want));
}
