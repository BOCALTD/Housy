import { PLATFORM_NAME } from "./labels";

/**
 * The legal pages: Terms, Privacy, Cookies, Community guidelines and Account deletion. Written in the blog's text format and
 * shown with the same safe renderer. Who operates the service comes from the deployment (LEGAL_ENTITY_NAME, LEGAL_ADDRESS,
 * PRIVACY_EMAIL, SUPPORT_EMAIL), so nothing about the operator is made up here. Changing a document's meaning means raising
 * LEGAL_VERSION, which asks signed-in people to agree again.
 */

export const LEGAL_VERSION = "2026-11-05";
export const LEGAL_UPDATED = "5 November 2026";

export function operator() {
  const name = process.env.LEGAL_ENTITY_NAME?.trim() || `the operator of ${PLATFORM_NAME}`;
  const address = process.env.LEGAL_ADDRESS?.trim() || "";
  const support = process.env.SUPPORT_EMAIL?.trim() || "";
  const privacy = process.env.PRIVACY_EMAIL?.trim() || support;
  return { name, address, support, privacy, configured: !!process.env.LEGAL_ENTITY_NAME?.trim() };
}

export type LegalDoc = { slug: string; title: string; summary: string; body: string };

export function legalDocs(): LegalDoc[] {
  const o = operator();
  const P = PLATFORM_NAME;
  const reach = o.privacy ? `by email at [${o.privacy}](mailto:${o.privacy}) or through [Contact and support](/support)` : "through [Contact and support](/support)";
  const who = `${P} is operated by ${o.name}${o.address ? `, ${o.address}` : ""} ("we", "us").`;
  return [
    {
      slug: "terms", title: "Terms of use", summary: `The rules for using ${P}: who can use it, what you may and may not do, and what we are and are not responsible for.`,
      body: `${who} These terms apply to everyone who uses ${P} on the web, as an installed app, or through our API. By creating an account or using ${P} you agree to them. If you do not agree, do not use ${P}.

## Who can use ${P}
- You must be **18 or over** and able to enter a binding agreement.
- You must give true information about yourself and, if you register a company or work as an agent, about your business.
- One person, one personal account. Company accounts are run by people the company authorises.

## What ${P} is
${P} is a marketplace and a set of tools. Companies and agents list property, and people search, inspect, chat and agree deals with them. Companies also use ${P} to run their work. **We are not a party to any rent, lease, sale or service agreement made between users**, and we do not own, inspect or guarantee any property unless we clearly say so.

## Your responsibilities
- **Inspect before you pay.** Never pay for a property you have not seen, and pay only to company accounts with a receipt.
- Listings must be real, available, lawfully offered, accurately described and priced, and posted with the authority of the owner.
- Respect other people. Follow the [Community guidelines](/legal/community).
- Keep your password and two-step codes secret. You are responsible for what happens in your account.

## Things you must not do
- Post fake, misleading, duplicate or bait listings, or content you do not have the rights to.
- Scam, harass, threaten, discriminate against or impersonate anyone.
- Collect other people's data, scrape ${P}, interfere with its security, or use it to send spam.
- Use ${P} for anything unlawful.

## Verification and trust levels
Badges and trust levels mean that particular checks were passed at a point in time. They are not a guarantee about any person, company or property. Always use your own judgement.

## Paid plans and payments
Some features for companies and agents are paid. Prices, what each plan includes, renewals and how to cancel are shown on [Plans and pricing](/pricing) and before you pay. Payments are processed by our payment provider. Refunds follow the refund terms shown at purchase and any rights you have under law.

## Content you post
You keep ownership of what you post. You give us a non-exclusive, worldwide, royalty-free licence to host, show, adapt (for example, resize photos) and share it in order to run and promote ${P}. You confirm you have the rights to everything you post. We may remove content or limit accounts that break these terms or the law.

## Reports, suspension and appeals
Anyone can report a listing, message, review or account. We review reports and may warn, hide content, suspend or close accounts. Where we act on your content or account, we tell you why and how to ask for a review, unless the law or safety prevents it.

## Ending your use
You can stop using ${P}, take a break, or delete your account at any time from **Profile and settings**. See [Delete your account](/legal/delete-account). We may close accounts that seriously or repeatedly break these terms.

## Our responsibility to you
We work to keep ${P} available, accurate and safe, but we provide it "as is". To the extent the law allows, we are not liable for losses caused by other users, by property you rent or buy, or by events outside our reasonable control. Nothing in these terms limits liability that cannot be limited by law, or your statutory rights as a consumer.

## Changes
We may update these terms. If a change matters, we will tell you on ${P} or by email before it takes effect, and ask you to agree again where needed.

## Law and disputes
These terms are governed by the laws of the Federal Republic of Nigeria. Please contact us first so we can try to resolve any problem; otherwise disputes go to the competent courts of Nigeria. If you live elsewhere, you keep any protection your own country's law gives you.

## Contact
Reach us ${reach}.`,
    },
    {
      slug: "privacy", title: "Privacy policy", summary: `What personal data ${P} collects, why, who it is shared with, how long it is kept, and your rights over it.`,
      body: `${who} We are the data controller for personal data processed to run ${P}. When a company uses ${P} to manage its own clients, tenants and records, **that company is the controller** of those records and we process them for it.

We follow the **Nigeria Data Protection Act 2023** and, for people in the European Economic Area and the United Kingdom, the GDPR and UK GDPR.

## What we collect
- **Account details**: name, email, phone (if you give it), password (stored only as a secure hash), profile and cover photos, bio, and your settings.
- **What you do on ${P}**: listings and reels you view, save, like or share; searches and alerts; inspections you book; reviews; reports. Used to show relevant homes and keep ${P} safe. You can turn personal suggestions off and clear them in [Privacy and my data](/me/privacy).
- **Messages** you send through ${P} chat.
- **Business and verification details** for companies and agents (for example registration numbers and director identity), and **identity checks** you choose to take, such as the flatmate ID check. Flatmate ID check pictures are used only for the check and deleted once it is decided.
- **Flatmate profile** answers you give, which are shown to possible matches.
- **Location** only when you choose it: a place you search or tap on the map, or a live location you share during a safety trip.
- **Technical data**: IP address, device and browser type, and security logs, used to keep accounts secure and stop abuse.
- **Payments**: handled by our payment provider; we receive the result and a reference, never your full card number.

## Why we use it, and the legal basis
- To provide ${P} and the features you ask for (**contract**).
- To keep ${P} safe, stop fraud and enforce our terms (**legitimate interests** and **legal obligation**).
- To send service emails and, if you agree, marketing and alerts (**consent**, which you can withdraw in notification settings).
- To verify companies, agents and flatmates (**consent** and **legitimate interests**).
- To keep records the law requires, such as payment records (**legal obligation**).

## Who we share it with
- **Other users**, as the feature needs: your public profile, listings, reviews and reels; your name and booking details with the agent you book; your messages with the people in the chat.
- **Service providers** who work for us under contract: hosting and storage, email delivery, payments, identity and business verification, push notifications, map data (OpenStreetMap-based services), and, where it is switched on, an AI service that helps answer questions (it receives the question and the facts needed to answer it). They may only use the data to provide their service to us.
- **Authorities**, when the law requires it or to protect someone's safety.
We **do not sell** personal data, and we do not use it for third-party advertising.

## International transfers
Some providers may process data outside Nigeria. When they do, we use safeguards the law recognises, such as adequacy decisions or contractual clauses.

## How long we keep it
We keep data while your account is open and as long as needed for the purpose. When you delete your account we delete or anonymise your personal data, except what we must keep by law (for example payment and tax records) or to deal with fraud, safety reports or legal claims. Flatmate ID check pictures are deleted once the check is decided; business verification records are kept while they are needed and as the law requires.

## Your rights
You can **see and download** your data, **correct** it, **delete** your account, **object** to or **restrict** some uses, **withdraw consent** at any time, and ask for **data portability**. Most of this is self-service in [Privacy and my data](/me/privacy) and [Profile and settings](/me/settings). For anything else, contact us ${reach}. You may also complain to the **Nigeria Data Protection Commission** or your local data protection authority.

## Security
Passwords are hashed, connections are encrypted, company records are kept apart by database rules, and two-step sign-in is available. No system is perfectly secure, so please use a strong password and tell us at once if you think your account has been misused.

## Children
${P} is for adults. It is not meant for anyone under 18, and we do not knowingly collect children's data. If you think a child has given us data, contact us and we will delete it.

## Cookies
See the [Cookie notice](/legal/cookies).

## Changes
We will post changes here and, if they matter, tell you before they take effect.`,
    },
    {
      slug: "cookies", title: "Cookie notice", summary: `${P} uses the cookies it needs to work, and two optional ones only if you allow them. No advertising or cross-site tracking cookies.`,
      body: `${P} uses a small number of cookies and similar browser storage. The first time you visit you choose **Accept all** or **Essential only**; you can change your choice at any time with the button at the end of this page. We do not use advertising cookies or third-party tracking cookies.

## Essential cookies (always used)
- **sid**: keeps you signed in. Removed when you sign out.
- **cookie_choice**: remembers your cookie choice. Lasts a year.
- **theme** and **pv_pref**: remember settings you choose yourself (light or dark, choices on property pages). Last up to a year.

## Optional cookies (only with "Accept all")
- **pv_vid**: a random code (not your name) so a property visit is counted once a day. Lasts up to a year.
- **ref**: remembers who invited you when you open a shared link, so they can be thanked. Lasts 30 days and is removed when you sign up.

With **Essential only**, neither is set, and any already set are removed.

## Storage in your browser
Your browser also keeps a few settings on your device, such as whether you have seen the welcome tour, the map layer you chose, properties you are comparing, and your current conversation with the assistant. You can clear them in your browser settings at any time.

## Third parties
Map pictures are loaded from map servers to draw the map. Those servers receive your IP address as any website would, but we do not let them set tracking cookies through ${P}.

When you pay online, the payment page is run by our payment provider (Paystack, or Stripe outside Paystack's countries), which uses its own cookies to process the payment safely. If ${P} offers live chat, it is run by a support chat provider (Tawk.to, Crisp, Tidio or Intercom) and starts only if you accept optional cookies; the provider then sets its own cookies to keep your conversation going, under its privacy policy. On sign-up, sign-in and some forms, a check that you are a person may be shown (Google reCAPTCHA or Cloudflare Turnstile, whichever ${P} uses); that check may use the provider's own cookies, under its privacy policy, to tell people from automated programs.

## Your choices
You can change your choice below, or block and delete cookies in your browser. If you block the sign-in cookie you will not be able to sign in.`,
    },
    {
      slug: "community", title: "Community guidelines", summary: `How to behave on ${P}: honest listings, respectful chat, real reviews, and what happens when someone breaks the rules.`,
      body: `${P} works when people can trust what they see. These guidelines apply to listings, reels, photos, profiles, reviews, flatmate profiles, comments and messages.

## Be honest
- List only property that exists, is available and that you are allowed to offer. Show real photos and the real price.
- Write reviews only about deals and experiences you really had.
- Never pretend to be someone else, or another company.

## Be respectful
- No harassment, threats, bullying, hate speech or discrimination, including on the basis of ethnicity, religion, sex, disability or any other protected trait.
- No sexual content, violence or graphic content.
- Do not share anyone's private information without their permission.

## Be safe
- No scams, advance-fee requests or pressure to pay before an inspection.
- No illegal goods, services or activity.
- No spam, chain messages or links to harmful sites.

## Reporting and blocking
Use **Report** on any listing, reel, review, profile or message. In chat you can **block** someone so they cannot message you again. The Trust and Safety team reviews every report, urgent safety reports first.

## What we do
Depending on how serious it is, we may remove content, hide listings, limit features, suspend or close accounts, and work with the authorities. If we act on your content or account, we tell you why and how to ask for a review.

See also [Trust and Safety](/trust) and the [Terms of use](/legal/terms).`,
    },
    {
      slug: "delete-account", title: "Delete your account", summary: `How to delete your ${P} account and data, from the app or the website, and what is kept.`,
      body: `You can delete your ${P} account at any time, from the app or the website.

## Delete it yourself
1. Sign in to ${P}.
2. Open **Profile and settings**, then **Delete account** (or go to [Privacy and my data](/me/privacy)).
3. Confirm with your password. Your account is closed at once.

You may want to [download your data](/me/privacy) first.

## If you cannot sign in
Use [Contact and support](/support) from the email address on your account and ask us to delete it. We confirm it is you, then delete it as soon as we can, and within the time the law requires.

## What is deleted
Your name, email, password, profile and cover photos, bio, saved searches, watched properties, personal suggestions, follows, flatmate profile and ID check, notifications and their settings, push devices and safety-trip locations are deleted. Your reels are taken down, your agent profile is removed from the directory, and your access to company workspaces ends. Reviews you wrote and messages you sent stay for the people who received them, shown as from "Deleted user".

## What is kept, and for how long
- Payment and tax records, for as long as the law requires.
- Records a company holds about its own clients or deals: they belong to that company. Ask the company directly.
- Information needed for an open safety report, fraud case or legal claim, until it is closed.

## Taking a break instead
If you only need time off, choose **Take a break** in Profile and settings. Your profile is hidden and emails pause until you sign in again.`,
    },
  ];
}

export function legalDoc(slug: string): LegalDoc | null {
  return legalDocs().find((d) => d.slug === slug) ?? null;
}
