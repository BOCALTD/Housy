import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { PLATFORM_NAME } from "@/lib/labels";
import { logoutAction } from "./auth-actions";

export const metadata: Metadata = {
  title: { default: PLATFORM_NAME, template: `%s · ${PLATFORM_NAME}` },
  description: "Discover verified property and manage property portfolios in one place.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
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
              {session ? (
                <>
                  <Link href="/app">Workspace</Link>
                  {session.user.isPlatformAdmin ? <Link href="/admin">Platform admin</Link> : null}
                  <form action={logoutAction}>
                    <button className="btn ghost small" type="submit">Sign out</button>
                  </form>
                </>
              ) : (
                <>
                  <Link href="/login">Sign in</Link>
                  <Link href="/signup" className="btn primary small">Register a company</Link>
                </>
              )}
            </nav>
          </div>
        </header>
        <main>
          <div className="wrap">{children}</div>
        </main>
      </body>
    </html>
  );
}
