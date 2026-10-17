import "./globals.css";
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

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  title: { default: PLATFORM_NAME, template: `%s · ${PLATFORM_NAME}` },
  description: "Discover verified property and manage property portfolios in one place.",
  openGraph: { type: "website", siteName: PLATFORM_NAME, title: PLATFORM_NAME, description: "Discover verified property and manage property portfolios in one place." },
  twitter: { card: "summary_large_image", title: PLATFORM_NAME },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#14284B" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1222" },
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
        <header className="top">
          <div className="wrap">
            <Link href="/" className="brand">
              <span className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinejoin="round"><path d="M3 11 12 4l9 7M6 10v10h12V10" /></svg>
              </span>
              {PLATFORM_NAME}
            </Link>
            <nav className="nav" aria-label="Main">
              <Link href="/">Find property</Link>
              <Link href="/directory">Agents and companies</Link>
              <Link href="/reels">Reels</Link>
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
                  <Link href="/login">Sign in</Link>
                  <Link href="/join">Create an account</Link>
                  <Link href="/signup" className="btn primary small">Register a company</Link>
                </>
              )}
            </nav>
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
        <main id="main" tabIndex={-1}>
          <div className="wrap">{children}</div>
        </main>
        <footer className="wrap" style={{ padding: "16px 0 32px" }}>
          <Link href="/support" className="btn ghost small">Help and support</Link>
        </footer>
      </body>
    </html>
  );
}
