/**
 * Look up nearby places and landmarks for every published property whose area is not known yet, so visitors see them at
 * once instead of waiting for the free map servers (which often take half a minute). Run after adding properties, or on a
 * schedule (daily is plenty: each area is kept for 30 days).
 *   npm run nearby:warm
 */
import { prisma } from "../src/lib/db";
import { tuneNetwork } from "../src/lib/network";
import { reportNearbyAttempts, warmAllNearby } from "../src/lib/services/nearby";
import { databaseReady } from "./db-ready";

tuneNetwork();
reportNearbyAttempts((a) => console.log(`    ${a.server}: ${a.result} after ${Math.round(a.ms / 1000)} s`));
databaseReady()
  .then((ready) => {
    if (!ready) process.exit(1);
    console.log("Looking up the areas of published properties that are not known yet. Each can take up to a minute…");
    return warmAllNearby(process.env, { onEach: (cell, ok, left) => console.log(`${ok ? "✓" : "✗"} area ${cell}${ok ? "" : " (the map servers did not answer; it is tried again next time)"}${left ? ` · ${left} to go` : ""}`) });
  })
  .then((r) => { console.log(r.looked ? `Done: ${r.ok} of ${r.looked} area${r.looked === 1 ? "" : "s"} found.` : "Every published property's area is already known."); process.exit(r.looked && !r.ok ? 1 : 0); })
  .catch((e) => { console.error(e instanceof Error ? e.message.split("\n").filter(Boolean).pop() : e); process.exit(1); })
  .finally(() => prisma.$disconnect());
