import { DemoStrip } from "@/components/DemoStrip";
import { Suspense } from "react";
import { AppToaster, UrlToasts } from "@/components/Toasts";
import "./globals.css";
import "./polish.css";
import "./home.css";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { unreadCount } from "@/lib/services/notifications";
import { unreadConversationCount } from "@/lib/services/messaging";
import { asPerson } from "@/lib/services/collab";
import { feedbackDue } from "@/lib/services/feedback";
import { PLATFORM_NAME } from "@/lib/labels";
import { snoozeAction } from "./feedback/actions";
import { NavigationLoader } from "@/components/NavigationLoader";
import { BackToTop } from "@/components/BackToTop";
import { SiteFooter } from "@/components/SiteFooter";
import { CompareBar } from "@/components/Compare";
import { ServiceWorker } from "@/components/Pwa";
import { Frame, type FrameNotice } from "@/components/Frame";
import { getMember } from "@/lib/auth";
import { ROLE_LABELS, can } from "@/lib/permissions";
import { myNotifications } from "@/lib/services/notifications";
import { asCompany, pendingIncoming } from "@/lib/services/collab";
import { portalCount } from "@/lib/services/portals";
import { waitingFlatmateRequests } from "@/lib/services/flatmates";
import { accountSection, adminSection, exploreSection, workspaceSection, type NavSection } from "@/lib/nav";
import { markAllNoticesReadAction } from "./frame-actions";
import { avatarUrlFor } from "@/lib/services/profile";
import { BootLoader } from "@/components/BootLoader";
import { HydrationFlag } from "@/components/HydrationFlag";
import { AmountFormat } from "@/components/AmountFormat";
import { FirstVisitIntro } from "@/components/FirstVisitIntro";
import "./intro.css";
import "./frame.css";
import "./chat.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  title: { default: PLATFORM_NAME, template: `%s · ${PLATFORM_NAME}` },
  description: "Find verified homes, land and commercial property in Nigeria, book inspections safely, and manage rent, tenants and documents in one place.",
  applicationName: PLATFORM_NAME,
  keywords: ["property in Nigeria", "houses for rent in Lagos", "land for sale", "verified agents", "flatmates", "property management"],
  openGraph: {
    type: "website", siteName: PLATFORM_NAME, locale: "en_NG", url: "/", title: `${PLATFORM_NAME}: find property you can trust`,
    description: "Verified companies and agents, inspections booked safely, and rent and documents in one place.",
  },
  twitter: { card: "summary_large_image", title: `${PLATFORM_NAME}: find property you can trust`, description: "Verified companies and agents, inspections booked safely, and rent and documents in one place." },
  appleWebApp: { capable: true, title: PLATFORM_NAME, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#111214" },
  ],
};

/** What the frame needs for a signed-in person: counts for the badges, the latest notices for the bell, and their company role. */
async function frameData(uid: string, inCompany: boolean) {
  const zero = () => 0;
  const [unread, unreadMsgs, rate, notes, incoming, portals, flatmateWaiting, member] = await Promise.all([
    unreadCount(uid).catch(zero), unreadConversationCount(asPerson(uid)).catch(zero), feedbackDue(uid).catch(() => false),
    myNotifications(uid, 8).catch(() => []), pendingIncoming(asPerson(uid)).catch(zero), portalCount(uid).catch(zero),
    waitingFlatmateRequests(uid).catch(zero), inCompany ? getMember().catch(() => null) : Promise.resolve(null),
  ]);
  const avatarUrl = await avatarUrlFor(uid).catch(() => null);
  return { unread, unreadMsgs, rate, notes, incoming, portals, flatmateWaiting, member, avatarUrl };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const uid = session?.user.id;
  const zero = () => 0;
  const d = uid ? await frameData(uid, !!session?.companyId) : null;
  const unread = d?.unread ?? 0, unreadMsgs = d?.unreadMsgs ?? 0, rate = d?.rate ?? false, member = d?.member ?? null;
  const incoming = d?.incoming ?? 0, portals = d?.portals ?? 0, flatmateWaiting = d?.flatmateWaiting ?? 0, notes = d?.notes ?? [];
  const sections: NavSection[] = [exploreSection()];
  if (session) sections.push(accountSection({ incoming, portals, flatmateWaiting, unreadMessages: unreadMsgs, unreadNotices: unread }));
  if (member) {
    const companyIncoming = can(member.role, "collab.view") ? await pendingIncoming(asCompany(member)).catch(zero) : 0;
    sections.push({ ...workspaceSection(member.role, companyIncoming), label: `Workspace · ${member.companyName}` });
  }
  if (session?.user.isPlatformAdmin) sections.push(adminSection());
  const notices: FrameNotice[] = notes.map((n) => ({ id: n.id, title: n.title, body: n.body.slice(0, 140), link: n.link, at: n.createdAt.toISOString(), unread: !n.readAt }));
  const user = session ? {
    name: session.user.name, email: session.user.email, isAdmin: session.user.isPlatformAdmin, avatarUrl: d?.avatarUrl ?? null,
    roleLabel: member ? `${ROLE_LABELS[member.role]} · ${member.companyName}` : session.user.isPlatformAdmin ? "Platform administrator" : "Personal account",
  } : null;
  return (
    <html lang="en-NG">
      <head>
        {/* Says so on screen if the app's scripts never start (public/health.js). */}
        <script src="/health.js" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Instrument+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        <a className="skip-link" href="#main">Skip to main content</a>
        <HydrationFlag />
        <AmountFormat />
        <BootLoader />
        <Suspense fallback={null}><FirstVisitIntro signedIn={!!session} name={PLATFORM_NAME} /></Suspense>
        <DemoStrip />
        <AppToaster />
        <Suspense fallback={null}><UrlToasts /></Suspense>
        <Frame sections={sections} user={user} notices={notices} unreadNotices={unread} unreadMessages={unreadMsgs} markAllRead={markAllNoticesReadAction}>
          {rate ? (
            <aside className="rate-banner" aria-label="Rate the platform">
              <div className="wrap">
                <span>How is {PLATFORM_NAME} serving you? Tell us what to improve.</span>
                <span className="row">
                  <Link className="btn primary" href="/feedback">Rate now</Link>
                  <form action={snoozeAction}><button className="btn" type="submit">Remind me later</button></form>
                </span>
              </div>
            </aside>
          ) : null}
          <NavigationLoader />
          <BackToTop />
          <ServiceWorker />
          <CompareBar />
          <main id="main" tabIndex={-1}>
            <div className="wrap">{children}</div>
          </main>
          <SiteFooter />
        </Frame>
      </body>
    </html>
  );
}
