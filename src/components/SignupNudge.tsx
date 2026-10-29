import Link from "next/link";
import { PLATFORM_NAME } from "@/lib/labels";

/**
 * Shown to people who are not signed in, on pages that can be shared: what they are missing and a one-tap way to join.
 * After joining or signing in they come straight back to the same page.
 */
export function SignupNudge({ path, shared, what, perks }: { path: string; shared: boolean; what: string; perks: string[] }) {
  const next = encodeURIComponent(path);
  return (
    <aside className="nudge" aria-labelledby="nudge-h">
      <div className="nudge-mark" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10" /></svg>
      </div>
      <div className="stack" style={{ gap: 6, minWidth: 0 }}>
        <p className="eyebrow">{shared ? "Shared with you" : `New to ${PLATFORM_NAME}?`}</p>
        <h2 id="nudge-h" className="nudge-h">{shared ? `Someone shared ${what} with you` : `See everything about ${what}`}</h2>
        <ul className="nudge-perks">{perks.map((p) => <li key={p}>{p}</li>)}</ul>
        <div className="row">
          <Link className="btn primary" href={`/join?next=${next}`}>Sign up free</Link>
          <Link className="btn" href={`/login?next=${next}`}>I have an account</Link>
        </div>
      </div>
    </aside>
  );
}

/** The last slide of a guest's photo carousel: a blurred preview of what is behind sign-up. */
export function LockedPhotos({ path, more, preview }: { path: string; more: number; preview: string | null }) {
  return (
    <figure className="shot shot-locked">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {preview ? <img src={preview} alt="" aria-hidden="true" loading="lazy" decoding="async" /> : null}
      <figcaption className="locked-over">
        <strong>+{more} more photo{more === 1 ? "" : "s"}</strong>
        <span>Sign up free to see them all</span>
        <Link className="btn primary small" href={`/join?next=${encodeURIComponent(path)}`}>Sign up free</Link>
      </figcaption>
    </figure>
  );
}
