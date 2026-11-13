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

## Still to build

4. Verification requests from customers, the allocation engine (eligibility by approval, services, states, workload,
   performance, conflicts), manual / automatic / customer-chosen assignment with recorded overrides, accept or decline
   with a reason, reassignment on time-out.
5. The case workflow (REQUESTED … COMPLETED, DISPUTED) with enforced transitions, inspections and evidence.
6. Reports: templates, findings labelled by kind (documentary, registry, physical, opinion), nuanced outcomes, internal
   review, Housy's quality review kept separate, immutable released versions with hashes, PDF, public verification by
   reference or QR code, revocation and supersession.
7. Pricing, invoices, payments, settlement, refunds and payouts as separate recorded states.
8. Complaints, disputes, performance indicators, credential expiry monitoring, conflict-of-interest declarations.
9. BOCA: apply through the network and be linked to its existing record (supported now) and its existing data carried over.
10. Further security, performance and end-to-end tests across the whole flow.
