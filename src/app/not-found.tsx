import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card stack" style={{ maxWidth: 520, marginInline: "auto" }}>
      <h1>Not found</h1>
      <p className="muted">This page does not exist, or you do not have access to it.</p>
      <Link className="btn" href="/">Go to the home page</Link>
    </div>
  );
}
