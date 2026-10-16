# Controlled pilot

A pilot answers one question: **can real people run real work on this, safely?** It is not a launch. It has a start, an end, and things that will be measured.

## Who
- 2 to 4 companies you know and trust, with different shapes (for example one small agent, one landlord with 20+ tenancies, one property manager with staff). Each agrees in writing that this is a pilot, may have faults, and that they keep their own records in parallel for the pilot period.
- A named contact in each company and a named person on your side who answers them.

## Rules
- Real data only after the import has been previewed and reconciled by a person from the company.
- Payments are recorded by hand (bank transfer) unless the Paystack steps in `LAUNCH-CHECKLIST.md` section D are done.
- A level 1 problem pauses the pilot for that company until understood.
- Four weeks. Weekly 20-minute call with each company.

## What to measure (agree the targets first; these are suggestions)
| Measure | How | Suggested pass |
|---|---|---|
| Records match their own books | Compare three leases per company, week 1 and week 4 | No unexplained difference |
| Can do the core jobs unaided | Register asset, create lease, record payment, reverse a payment, run the rent report, report maintenance | Each person completes each job without help by week 2 |
| Errors | Count of server errors in the logs per week; level 1 and 2 incidents | No level 1; level 2 each fixed within a day |
| Email delivered | `/admin/notifications` figures | Gave up = 0 for real addresses |
| Speed felt by people | Ask: "Was anything slow?" and note the page and the phone | No page named more than twice |
| Support load | Contacts per company per week by cause | Falling by week 3 |
| Would they continue | Ask the administrator directly at week 4 | Yes, and why |

## Feedback record (one row per item)
Date · company · person · page · what they tried · what happened · how bad (blocks work / slows work / annoys) · screenshot · decision (fix now / fix later / not doing / explain better) · done on.

Review the list weekly. Fix **blocks work** items before the next week. A confusing screen is a usability problem even if the code is right; fix the screen or the words.

## End of the pilot
Write one page: what worked, what was fixed, what is still open, each company's decision, and a recommendation (widen, extend, stop). Update `RELEASE-APPROVAL.md` from it.

## What this pilot has not been
As of this document **no pilot has been run**. These pages are the plan. Nothing here is a result.
