# The verification network

Housy is the platform, standard-setter and overseer. Verification providers are independent, vetted professional
organisations. Every provider, BOCA included, uses the same tables, routes, roles and rules: there is no provider-specific
code anywhere.

## Built (stages 1 to 3)

| Stage | What | Where |
|---|---|---|
| 1 | "Become a verification partner": a structured application in four parts plus documents, saved as you go, with a reference (VPA-YYYY-NNNNNN), statuses DRAFT → SUBMITTED → UNDER_REVIEW → ADDITIONAL_INFORMATION_REQUIRED → RESUBMITTED → APPROVED / REJECTED / WITHDRAWN, only along allowed moves. Housy reviews, asks for more, keeps internal notes, approves or rejects with a reason. Every step is recorded (append-only). | `/verification-partners`, `/admin/verification` |
| 2 | Approval creates the provider organisation (or links one listed before, without marking it vetted until then) with a permanent provider ID (HVP-NNNNNN), what it is approved for (services, states), and an owner invitation to the authorised representative. Approval comes before activation. The organisation's dashboard (one reusable dashboard, branded with its own name and logo), profile, services with prices and turnaround, coverage and documents. | `/verification-partners/activate/[token]`, `/provider/[code]` |
| 3 | Six roles (owner, administrator, verification manager, field investigator, professional reviewer, finance officer) with permissions checked on the server for every action and again by row-level security; only owners manage owners and administrators; at least one owner always remains; suspend, restore, remove, invite, cancel invitations. | `/provider/[code]/staff` |

Housy can suspend a provider (records kept, read-only, no new staff or changes) and narrow or widen what it is approved for.

## Isolation

Row-level security on every network table (migration `20261230000000_verification_network`):
`app_provider_role(provider_id)` is the signed-in person's active role in that provider, `app_provider_active(provider_id)`
whether it may work. A provider's members see only that provider's staff, invitations, documents and application;
writes need an owner or administrator role and an active (approved, not suspended) provider; offerings and coverage are
limited to what Housy approved. Applicants see only their own application, never Housy's internal notes, and cannot move
it to approved. `provider_members` is not forced on its owner so the role lookup does not loop; the app's role is bound by
every policy. Tests: `tests/integration/phase19a.test.ts` (including direct database attempts across providers).

## Built (stages 4 to 6)

| Stage | What | Where |
|---|---|---|
| 4 | A customer asks for a verification from any listing or for any property (address, state, type, the checks wanted, documents held, owner, transaction). Reference HVR-YYYY-NNNNNN. Housy confirms it (or waits for payment, or declines with a reason), then offers it to a provider. Providers are ranked from their records: vetted, not suspended, approved for every service and the state, offering the services, covering the state, no declared conflict, open cases against capacity, then on-time record, declines, price and turnaround. Ineligible for a hard reason (not vetted, suspended, not approved, conflict) can never be chosen; otherwise ineligible is an override that needs a reason, recorded with the administrator and time. Methods: Housy's choice, the recommended provider, the customer's choice. The provider accepts, or declines with a reason, or declares a conflict (it is then never offered the case). Unanswered offers expire after 48 hours and come back to Housy. | `/verification/request`, `/verification/cases`, `/admin/verification/cases` |
| 5 | Twenty statuses with the allowed moves in `src/lib/verification-case-rules.ts`, checked by the services and again by a database trigger. The provider names an officer and a different reviewer; field investigators see only cases given to them. Document review, questions to the customer (who answers on their page), site visits booked and recorded, evidence with what kind of finding it supports, location and time taken, fingerprinted on upload. Append-only history; the customer sees the steps meant for them. | `/provider/[code]/cases`, `/provider/cases/[ref]` |
| 6 | The report: scope, documents examined, sources, registry search, site inspection, findings each labelled documentary / registry / physical / opinion, risks, limitations, outstanding issues, observations, recommendations, conclusion and one of seven outcomes. It cannot go for review incomplete. The provider's reviewer (never the person who wrote that version) approves it, after which its content is locked. Housy's quality and compliance review is separate and shown separately on the PDF. Release fingerprints the version (SHA-256 of its canonical content) and fixes it for ever; a correction is a new version that records what it corrects, and the old one is marked superseded. Housy can revoke a released report. Anyone can check a report by its VR- reference: genuine, current version, superseded or revoked, fingerprint; nothing confidential. Disputes reopen the case to Housy's review. | `/verification/report/[ref]/[version]`, `/verification/check` |

Migration `20261231000000_verification_cases`: the case guard trigger (allowed moves, requester and reference never change,
only Housy changes the provider except a provider declining), the report version guard (no deletes, content locked after the
provider's approval, a released version never changes except being marked superseded or revoked once), and row-level
security on all eight tables. Tests: `tests/unit/verification-cases.test.ts` (the trigger's moves equal the rules) and
`tests/integration/phase19b.test.ts` (the whole flow, overrides, conflicts, expiry, isolation between providers and from
investigators not on the case, the customer never seeing evidence or unreleased versions, immutability through the database).

## Built (stage 7: money)

| What | How |
|---|---|
| Quote | Housy quotes a new request (`/admin/verification/cases/[ref]`). Housy's fee (15%, `PLATFORM_FEE_BPS`) and the provider's share are fixed on the case; the database refuses any later change. The provider sees its share on the offer before accepting. |
| Invoice and payment | The quote is an ordinary platform invoice (purpose VERIFICATION) the customer pays from `/me/billing/[id]`: online through the configured payment provider (verified provider messages only), or by bank transfer an administrator confirms in Payments. A paid invoice moves the case to "Ready for a provider" by itself. The money is held (FUNDS_HELD in the VERIFICATION ledger). A case can also be taken on as paid outside Housy, with a note. Cancelling an unpaid case withdraws its invoice; cancelling a paid one tells Housy to refund. |
| Earning | Created when the report is released: price, fee, share. Waiting for the customer; payable when the customer confirms or 7 days pass without a dispute (scheduled job and on page load); held by a dispute or revocation; cancelled by a full refund. Becoming payable recognises it in the books: held money out, Housy's fee to REVENUE, the share to PROVIDER_PAYABLE. |
| Refund | Through Payments as for any invoice, while the money is still held. Once it is the provider's earning the refund is refused with an explanation. |
| Payout | `/admin/verification/payouts`: Housy prepares a payout of a provider's payable earnings to its bank account on record, makes the bank transfer itself (no automatic transfer exists), and records the transfer reference and date. A paid payout and its earnings never change (trigger). Cancelling a prepared payout returns its earnings. |
| Provider | `/provider/[code]/finance` for the owner and finance staff: totals by state, earnings (paged), payouts, the payout bank account (10-digit NUBAN; everyone handling money is told of a change; no change while a payout is prepared) and a CSV statement. |
| Books | `reconcileFinance` also checks that what is owed to providers equals their recognised unpaid earnings, every paid payout is booked, and nothing unrecognised is paid. |

Migration `20270101000000_verification_finance`; tests in `tests/unit/verification-finance.test.ts` (split, moves equal the trigger)
and the money test in `tests/integration/phase19b.test.ts`.

## Still to build

8. Complaints, performance indicators, credential expiry monitoring.
9. BOCA: apply through the network and be linked to its existing record (supported now) and its existing data carried over.
10. Further security, performance and end-to-end tests across the whole flow.
