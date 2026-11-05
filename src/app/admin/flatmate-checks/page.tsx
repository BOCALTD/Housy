import { requirePlatformAdmin } from "@/lib/auth";
import { ID_TYPES, flatmateCheckQueue } from "@/lib/services/flatmates";
import { formatDateTime } from "@/lib/dates";
import { decideCheckAction } from "./actions";

export const metadata = { title: "ID checks" };
export const dynamic = "force-dynamic";

export default async function FlatmateChecksPage() {
  const admin = await requirePlatformAdmin();
  const rows = await flatmateCheckQueue(admin.id);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>ID checks</h1>
        <p className="muted">Compare the selfie with the photo on the ID, and check the ID looks genuine and readable. The pictures are deleted 30 days after your decision. Do not copy or save them.</p>
      </div>
      {rows.length === 0 ? <section className="card"><p className="muted">Nothing waiting.</p></section> : rows.map((r) => (
        <section key={r.userId} className="card stack">
          <div className="row between"><div><strong>{r.user.name}</strong> <span className="small muted">· {r.user.email}{r.profile ? ` · flatmates as "${r.profile.displayName}" in ${r.profile.city}` : ""}</span></div><span className="small muted">Sent {formatDateTime(r.submittedAt)}</span></div>
          <p className="small">ID: {ID_TYPES[r.idType as keyof typeof ID_TYPES] ?? r.idType}</p>
          <div className="idcheck-grid">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <figure className="card" style={{ margin: 0 }}><img src={`/admin/flatmate-checks/${r.userId}/doc`} alt={`ID photo from ${r.user.name}`} style={{ width: "100%", borderRadius: 10 }} /><figcaption className="small muted">ID photo</figcaption></figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <figure className="card" style={{ margin: 0 }}><img src={`/admin/flatmate-checks/${r.userId}/selfie`} alt={`Selfie from ${r.user.name}`} style={{ width: "100%", borderRadius: 10 }} /><figcaption className="small muted">Selfie</figcaption></figure>
          </div>
          <form action={decideCheckAction} className="row">
            <input type="hidden" name="userId" value={r.userId} />
            <input name="note" maxLength={400} placeholder="Reason if sending back, e.g. the ID is blurred" aria-label="Note to the person" />
            <button className="btn primary" type="submit" name="decision" value="verify">Verify</button>
            <button className="btn" type="submit" name="decision" value="reject">Send back</button>
          </form>
        </section>
      ))}
    </div>
  );
}
