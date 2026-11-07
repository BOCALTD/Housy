/**
 * For command-line tools: make sure the database is up. On Ubuntu under Windows it does not start by itself after a
 * restart, so this starts it (sudo may ask for the Ubuntu password) and says what to run if that does not work.
 */
import { spawnSync } from "node:child_process";
import { prisma } from "../src/lib/db";

export async function databaseReady(): Promise<boolean> {
  const up = () => prisma.$queryRaw`select 1`.then(() => true, () => false);
  if (await up()) return true;
  console.log("The database is not running. Starting it (your Ubuntu password may be asked for)…");
  spawnSync("sudo", ["service", "postgresql", "start"], { stdio: "inherit" });
  for (let i = 0; i < 15; i++) { if (await up()) return true; await new Promise((r) => setTimeout(r, 1000)); }
  console.error("The database still is not running. Start it with:  sudo service postgresql start  then run this again.");
  return false;
}
