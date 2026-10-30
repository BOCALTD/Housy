/** `npm run db:seed:demo`: the normal seed plus the demonstration data and sample catalogue, on any operating system. */
process.env.SEED_DEMO_DATA = "true";
void import("./seed");
