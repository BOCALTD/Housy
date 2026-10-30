import Link from "next/link";

export const metadata = { title: "You are offline", robots: { index: false } };

// Shown by the installed app when there is no connection. Kept anonymous: the service worker fetches it without cookies.
export default function OfflinePage() {
  return (
    <div className="offline-page stack">
      <p className="eyebrow">No connection</p>
      <h1>You are offline</h1>
      <p className="muted">Pages you opened recently, like property listings and help pages, may still be readable. Anything that changes your records, sends a message or books an inspection needs a connection. Inspectors can keep working in the field kit, which saves on this device and sends when you are back online.</p>
      <div className="row" style={{ justifyContent: "center" }}>
        <Link className="btn primary" href="/">Try again</Link>
        <Link className="btn" href="/browse">Browse property</Link>
        <a className="btn" href="/field">Field kit</a>
      </div>
    </div>
  );
}
