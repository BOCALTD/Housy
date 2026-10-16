# Performance results

Measured by `tests/integration/zz1-performance.test.ts` in CI on a shared GitHub-hosted runner (2 vCPU, PostgreSQL 16 in a container, **the same database role and row-level security the live app uses**). Times are the best of 3 runs of the real service function, so they include the database round trips and the security checks but not the network, the browser or React rendering.

## What was loaded
One company with **12,000 assets, 12,000 listings (70% published), 2,500 leases and 30,000 rent charges**, plus 30 photographs of 1 MB each. That is a large portfolio for one company; there is no data yet on what real customers hold.

## Results (CI run 38929264383)
| Page or action | Best of 3 | Allowed | Notes |
|---|---|---|---|
| Public browse, no filters | 2.5 ms | 800 ms | Reads the `published_at` index, no sort (checked from the query plan) |
| Search: rent in Lekki under ₦300m, 2+ beds | 7.6 ms | 1,000 ms | |
| Search by words in the title | 7.8 ms | 1,000 ms | |
| Search that matches nothing | 6.5 ms | 1,000 ms | |
| Public map points | 9.4 ms | 1,500 ms | |
| Company dashboard | 11.6 ms | 2,500 ms | |
| Company analytics | 68.6 ms | 4,000 ms | |
| Rent report for a year (2,500 leases) | 113.2 ms | 4,000 ms | Page shows 25 rows at a time |
| Asset register, first page | 8.7 ms | 1,000 ms | 25 per page |
| Asset register, page far down | 9.4 ms | 1,000 ms | |
| Asset register, search by name | 21.3 ms | 1,500 ms | `ILIKE '%…%'`, see below |
| Asset drop-down (forms) | 3.7 ms | 1,000 ms | Limited to 1,000 options |
| Portfolio map | 13.4 ms | 2,500 ms | |
| 30 MB of photographs, one by one | 143 ms | 6,000 ms | Stored in the database |
| 30 MB of photographs, ten at a time | 100 ms | 6,000 ms | |
| Loading the test portfolio | 907 ms | — | |

The limits are deliberately loose so a slow shared machine does not raise false alarms. They are there to catch a query that begins to read a whole table or a page that begins to send everything, not to promise a response time. The measured times are one to two orders of magnitude under them.

## What was found and fixed
1. **Browse sorted every published listing.** The first index, `(status, published_at)`, was never used by the live app: row-level security adds conditions that stop PostgreSQL choosing a status-first index for public reads. Found by testing as the app role, not as the owner. Replaced by an index on `published_at` alone; the plan is now an index scan with a limit and no sort.
2. **Asset drop-downs stopped at 200 assets**, so a company with more could not choose its own property in a form. Now up to 1,000, ordered by reference, and the asset register pages 25 at a time with Previous/Next.
3. **The rent report drew every row on one page.** Now 25 per page; the totals still cover everything.

## What is not measured
- **Browser time.** No test measured how long a page takes to draw on a phone over a slow connection. Pages are server-rendered with little script, and the device check confirms they fit and are usable at phone sizes, but nobody has timed them on a real phone on a Nigerian mobile network.
- **Many people at once.** The tests run one request at a time, apart from ten parallel photo reads and the concurrent-payment tests. There was **no load test** with hundreds of simultaneous visitors. Neon's connection limits and Vercel's concurrency are the likely first limits; test them before a launch.
- **Substring search.** Searching asset names and listing text uses `ILIKE '%…%'`, which cannot use an ordinary index. It is fast at 12,000 rows (21 ms) because it reads one company's rows only. At several hundred thousand rows per company it would need a `pg_trgm` index. Not added yet.
- **Photographs in the database.** Fine at this size. Storing media in the database makes backups and the database larger; moving to an object store is the next step if photographs grow into the tens of gigabytes.
