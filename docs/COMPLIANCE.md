# Compliance: app stores and international standards

What Housy already does, and what the owner must still do before submitting to the Apple App Store and Google Play. Items marked **Owner** need your accounts, legal entity or a decision; Housy cannot do them for you.

## Before you submit (Owner)

1. **Name the operator.** Set `LEGAL_ENTITY_NAME`, `LEGAL_ADDRESS` and `PRIVACY_EMAIL` on the server. They appear on `/legal/terms` and `/legal/privacy`. The admin readiness page warns until they are set.
2. **Have a lawyer review the legal pages.** `/legal/terms`, `/legal/privacy`, `/legal/cookies`, `/legal/community`, `/legal/delete-account` (source: `src/lib/legal.ts`) are a careful starting point written to match what Housy really does, but they are not legal advice. When the meaning changes, raise `LEGAL_VERSION`.
3. **Register with the Nigeria Data Protection Commission (NDPC)** if Housy meets the threshold for a data controller of major importance, and appoint a Data Protection Officer if required. File the annual compliance audit when due.
4. **Developer accounts.** Apple Developer Program and Google Play Console, in the company's name (an organisation account needs a D-U-N-S number).
5. **Package the app.** Housy is an installable web app (PWA). For the stores, wrap it: Google Play accepts a Trusted Web Activity (Bubblewrap/PWABuilder); for iOS use a native shell such as Capacitor. Apple rejects apps that are only a website in a frame (Guideline 4.2), so the iOS shell should use native features: push notifications, the camera for listing photos and the ID check, share sheet, and offline field kit.

## Store URLs to enter

| Field | URL |
|---|---|
| Privacy policy | `https://<your domain>/legal/privacy` |
| Terms of use / EULA | `https://<your domain>/legal/terms` |
| Support | `https://<your domain>/support` |
| Account deletion (Google Play, required) | `https://<your domain>/legal/delete-account` |
| Marketing site | `https://<your domain>/` |

## Apple App Store Review Guidelines

| Guideline | Status in Housy |
|---|---|
| 1.2 User-generated content: filter, report, block, published contact | Done: report on listings, reels, reviews, profiles and messages; block in chat; moderation queues at `/admin/moderation`; Community guidelines; support page. |
| 1.4 / 5.1.1 Safety, data collection, consent | Done: sign-up asks for an unticked agreement to the Terms and Privacy policy and confirmation of age 18+, recorded with the version (`legal.accepted` in the audit trail). Location is used only when the person chooses (map, safety trip). |
| 2.1 Completeness | Give Apple a working demo login (a personal account and a company account) in App Review notes. Never use real customer data. |
| 3.1.1 In-app purchase | **Owner decision.** Company and agent plans are digital subscriptions. If they can be bought inside the iOS app, Apple requires In-App Purchase. The usual route for B2B tools: do not sell plans inside the iOS app (show "Manage your plan on the web" with no buy button or external link), and keep paying on the web via Paystack. Rent, deposits and real-estate services are physical/real-world services and are exempt. |
| 4.8 Sign in with Apple | Not required: Housy has no third-party social sign-in. If Google or Facebook sign-in is ever added, add Sign in with Apple too. |
| 5.1.1(v) Account deletion in the app | Done: Profile and settings → Delete account, plus `/legal/delete-account`. |
| 5.1.2 Data use and sharing | No advertising tracking, no data sales, so App Tracking Transparency is not needed. Fill the privacy "nutrition label" from the table below. |

## Google Play policies

| Policy | Status |
|---|---|
| User data, prominent disclosure | Done: Privacy policy; location only on the person's action. |
| Account deletion (in app and web link) | Done. |
| UGC policy | Done (see 1.2 above). |
| Families / target audience | Set the target audience to **18 and over**. |
| Data safety form | Use the table below. |
| Financial features | Housy does not lend money or hold funds as a bank. Payments go through Paystack. |

## Data collected (for Apple's label and Google's Data safety form)

| Data | Collected | Linked to the person | Purpose | Optional |
|---|---|---|---|---|
| Name, email | Yes | Yes | Account, communication | No |
| Phone | Yes | Yes | Bookings, agent verification | Yes for personal accounts |
| Photos (profile, cover, listings, reels) | Yes | Yes | App functionality | Yes |
| Government ID image (flatmate ID check, agent KYC) | Yes | Yes | Verification; flatmate check images are deleted after the decision | Yes |
| Precise location | Only on the person's action | Yes | Safety trip sharing, nearby search | Yes |
| Messages | Yes | Yes | App functionality | Yes |
| Search and viewing history | Yes | Yes | Personalisation (can be switched off and cleared) | Yes |
| Payment info | Handled by Paystack; Housy keeps a reference | Yes | Purchases | Yes |
| Diagnostics, IP address | Yes | Yes | Security, fraud prevention | No |
| Advertising ID / cross-app tracking | **No** | | | |

Data is encrypted in transit (HTTPS). People can request deletion (self-service).

## International standards

- **Data protection:** Nigeria Data Protection Act 2023 and GDPR-style rights are served in the app: download your data, correct it, delete your account, withdraw marketing consent, switch off personal suggestions (`/me/privacy`).
- **Accessibility (WCAG 2.2 AA):** the device check in CI fails a build on touch targets under 44px, text under 12px, sideways scrolling, missing labels, missing alt text, missing page language or more or fewer than one main heading per page. Motion runs only when the person has not asked for reduced motion.
- **Security:** passwords hashed, optional two-step sign-in (required for platform administrators when `REQUIRE_ADMIN_MFA=true`), database row-level security between companies, rate limits, audit trail, no secrets in the code.
- **Cookies:** only essential cookies (listed on `/legal/cookies`), so no consent banner is required under the ePrivacy rules or the NDPA; the notice is linked in the footer.
- **Search engines:** sitemap, robots rules, canonical links, Open Graph and X cards, RSS for the blog.
