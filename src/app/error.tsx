"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card stack" style={{ maxWidth: 520, marginInline: "auto" }}>
      <h1>Something went wrong</h1>
      <p className="muted">The error has been logged. Try again, and contact support if it keeps happening.</p>
      <button className="btn" type="button" onClick={reset}>Try again</button>
    </div>
  );
}
