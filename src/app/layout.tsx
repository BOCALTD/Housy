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
import { logoutAction } from "./auth-actions";
import { NavigationLoader } from "@/components/NavigationLoader";
import { BackToTop } from "@/components/BackToTop";
import { SiteFooter } from "@/components/SiteFooter";
import { CompareBar } from "@/components/Compare";
import { ServiceWorker } from "@/components/Pwa";
import { HeaderNav } from "@/components/HeaderNav";
import { BootLoader } from "@/components/BootLoader";
import { Logo } from "@/components/Logo";
import { FirstVisitIntro } from "@/components/FirstVisitIntro";
import "./intro.css";

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const unread = session ? await unreadCount(session.user.id).catch(() => 0) : 0;
  const unreadMsgs = session ? await unreadConversationCount(asPerson(session.user.id)).catch(() => 0) : 0;
  const rate = session ? await feedbackDue(session.user.id).catch(() => false) : false;
  return (
    <html lang="en-NG">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Instrument+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        <a className="skip-link" href="#main">Skip to main content</a>
        <BootLoader />
        <Suspense fallback={null}><FirstVisitIntro signedIn={!!session} name={PLATFORM_NAME} /></Suspense>
        <DemoStrip />
        <AppToaster />
        <Suspense fallback={null}><UrlToasts /></Suspense>
        <header className="top">
          <div className="wrap">
            <Link href="/" className="brand" aria-label={`${PLATFORM_NAME} home`}>
              <Logo height={30} />
            </Link>
            <HeaderNav>
              <Link href="/">Find property</Link>
              <Link href="/directory">Agents and companies</Link>
              {session ? (
                <>
                  {session.companyId ? <Link href="/app">Workspace</Link> : null}
                  <Link href="/referrals">Earn</Link>
                  <Link href="/messages">Messages{unreadMsgs > 0 ? ` (${unreadMsgs})` : ""}</Link>
                  <Link href="/me">My account{unread > 0 ? ` (${unread})` : ""}</Link>
                  {session.user.isPlatformAdmin ? <Link href="/admin">Platform admin</Link> : null}
                  <form action={logoutAction}>
                    <button className="btn ghost small" type="submit">Sign out</button>
                  </form>
                </>
              ) : (
                <>
                  {/* One way in: sign in, and from there create an account if you have none. */}
                  <Link href="/login" className="btn primary small">Sign in</Link>
                </>
              )}
            </HeaderNav>
          </div>
        </header>
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
      </body>
    </html>
  );
}
