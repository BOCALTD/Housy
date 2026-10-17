import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/auth";
import { getVacancyAdmin } from "@/lib/services/vacancies";
import { STAGE_TEXT, nextStage } from "@/lib/vacancy-rules";
import { formatKobo } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { advanceAction, approveAction, askAction, authoriseAction, declineAction, duplicateAction, leadAction, linkAction, rejectAction, signalsAction, transactionAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vacancy report" };

export default async function AdminVacancyPage({ params: paramsP, searchParams: searchP }: { params: Promise<{ id: string }>; searchParams?: Promise<SP> }) {
  const params = await paramsP;
  const searchParams = await searchP;
  const admin = await requirePlatformAdmin();
  const r = await getVacancyAdmin(admin.id, params.id);
  if (!r) notFound();
  const open = r.outcome === "OPEN";
  const next = nextStage(r.stage);
  const hidden = (name: string) => <input type="hidden" name={name} value={r.id} />;
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>{r.ref}: {humanize(r.propertyType)} in {r.area}</h1><p className="muted"><Link href="/admin/vacancies">All reports</Link> · {STAGE_TEXT[r.stage].label} · <Pill status={r.outcome} /></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="card stack"><h2>The report</h2>
        <p className="small">{r.address}, {r.area}, {r.city}, {r.state}{r.lat !== null ? ` · ${r.lat}, ${r.lng}` : ""}. Seen {formatDate(r.observedOn)}. {r.bedrooms !== null ? `${r.bedrooms} bedrooms. ` : ""}Looks available for {humanize(r.purpose).toLowerCase()}.</p>
        <p>{r.description}</p>
        {r.ownerContact ? <p className="small">The reporter says about the owner: {r.ownerContact}</p> : null}
        {r.files.length ? <ShowMore noun="more photographs" limit={3} items={r.files.map((f) => <li key={f.id}><Link href={`/vacancies/file/${f.id}`}>{f.name}</Link></li>)} /> : <p className="small muted">No photographs.</p>}
        {r.reusedIn.length ? <p className="small"><strong>A photograph here also appears in:</strong> {r.reusedIn.join(", ")}</p> : null}
      </section>

      <section className="card stack"><h2>The reporter</h2>
        <p className="small">{r.reporter.name}{r.reporter.email ? ` · ${r.reporter.email}` : " · does not allow contact outside the app. Use the question button, which they see in the app."}</p>
        <p className="small muted">An owner would be told: “{r.ownerSees}”. The public is never told.</p>
      </section>

      {r.flagged ? (
        <section className="card stack"><h2>Warning signs</h2>
          <p className="small muted">These are reasons to look, not findings.</p>
          <ul className="small">{r.signalText.map((t) => <li key={t}>{t}</li>)}</ul>
          <details className="inline"><summary>Decide</summary><form action={signalsAction} className="stack">{hidden("id")}<Field label="What you found"><input name="note" required minLength={5} maxLength={500} /></Field><div className="row"><button className="btn primary" type="submit" name="decision" value="clear">Looks genuine</button><button className="btn" type="submit" name="decision" value="confirm">Reject the report</button></div></form></details>
        </section>
      ) : null}

      {r.duplicateOfId || r.cluster.length ? (
        <section className="card stack"><h2>Same property</h2>
          <ul className="small">{r.cluster.map((c) => <li key={c.id}><Link href={`/admin/vacancies/${c.id}`}>{c.ref}</Link> · {formatDate(c.createdAt)} · {humanize(c.outcome)}{c.id === r.duplicateOfId ? " · the earlier report" : ""}</li>)}</ul>
          {r.duplicateOfId && ["OPEN", "NEEDS_INFO"].includes(r.outcome) ? (
            <details className="inline"><summary>Decide</summary><form action={duplicateAction} className="stack">{hidden("id")}<Field label="Reason, recorded"><input name="note" required minLength={5} maxLength={500} /></Field>
              <div className="row"><button className="btn" type="submit" name="decision" value="not_duplicate">Not a duplicate</button><button className="btn" type="submit" name="decision" value="merge">Merge into the earlier report</button><button className="btn" type="submit" name="decision" value="prefer_this">Use this report instead (override)</button></div></form></details>
          ) : null}
        </section>
      ) : null}

      <section className="card stack"><h2>Review</h2>
        {open && next ? <form action={advanceAction} className="row">{hidden("id")}<input name="note" placeholder="What you checked (optional)" aria-label="What you checked" /><button className="btn primary" type="submit">Pass: move to {STAGE_TEXT[next].label.toLowerCase()}</button></form> : null}
        {open && r.stage === "REWARD_REVIEW" ? <form action={approveAction} className="row">{hidden("id")}<input name="note" placeholder="Note (optional)" aria-label="Note" /><button className="btn primary" type="submit">Verify and open the reward</button></form> : null}
        {open ? <details className="inline"><summary>Ask the reporter a question</summary><form action={askAction} className="row">{hidden("id")}<input name="question" required minLength={5} maxLength={500} placeholder="Shown to the reporter" aria-label="Question" /><button className="btn" type="submit">Send</button></form></details> : null}
        {["OPEN", "NEEDS_INFO"].includes(r.outcome) ? <details className="inline"><summary>Reject</summary><form action={rejectAction} className="row">{hidden("id")}<input name="reason" required minLength={5} maxLength={500} placeholder="Reason the reporter will read" aria-label="Reason" /><button className="btn" type="submit">Reject</button></form></details> : null}
        {r.outcome === "APPROVED" ? <details className="inline"><summary>A transaction was completed</summary><form action={transactionAction} className="row">{hidden("id")}<input name="note" required minLength={5} maxLength={500} placeholder="How you know" aria-label="How you know" /><button className="btn" type="submit">Record</button></form></details> : null}
      </section>

      <section className="card stack"><h2>Owner or authorised agent</h2>
        <p className="small muted">{r.listingNote}</p>
        {r.lead ? <p className="small">Contact: <strong>{r.lead.contactName}</strong> · {humanize(r.lead.status)}{r.lead.authorisationNote ? ` · ${r.lead.authorisationNote}` : ""}{r.lead.listingId ? " · listing linked" : ""}</p> : <p className="small muted">Nobody contacted yet.</p>}
        {!["REJECTED", "WITHDRAWN", "MERGED"].includes(r.outcome) ? <form action={leadAction} className="row">{hidden("id")}<input name="contactName" required minLength={2} maxLength={200} placeholder="Who you contacted" aria-label="Who you contacted" /><button className="btn" type="submit">Save contact</button></form> : null}
        {r.lead && r.lead.status === "CONTACTING" ? <details className="inline"><summary>They gave permission</summary><form action={authoriseAction} className="row">{hidden("id")}<input name="note" required minLength={5} maxLength={500} placeholder="How permission was given" aria-label="How permission was given" /><button className="btn primary" type="submit">Record permission</button></form></details> : null}
        {r.lead && r.lead.status !== "DECLINED" ? <details className="inline"><summary>They declined</summary><form action={declineAction} className="row">{hidden("id")}<input name="reason" required minLength={5} maxLength={500} placeholder="What they said" aria-label="What they said" /><button className="btn" type="submit">Record</button></form></details> : null}
        {r.lead && r.lead.status === "AUTHORISED" && !r.lead.listingId ? <details className="inline"><summary>Link the published listing</summary><form action={linkAction} className="row">{hidden("id")}<input name="listing" required minLength={3} placeholder="Listing reference" aria-label="Listing reference" /><button className="btn" type="submit">Link</button></form></details> : null}
      </section>

      <section className="card"><h2>Rewards</h2>
        {r.rewards.length === 0 ? <p className="muted">None yet.</p> : <ul className="timeline">{r.rewards.map((w) => <li key={w.id}><div className="row between"><span>{humanize(w.event)} · {formatKobo(w.amountKobo)}</span><Pill status={w.status} /></div><div className="small muted">{w.ref}{w.flag ? ` · ${w.flag}` : ""}</div></li>)}</ul>}
      </section>

      <section className="card"><h2>History</h2>
        <ShowMore noun="earlier entries" limit={5} items={r.events.slice().reverse().map((e) => <li key={e.id}><div className="small muted">{formatDateTime(e.createdAt)} · {e.actorName}{e.toReporter ? "" : " · internal"}</div><div>{e.note || (e.stage ? STAGE_TEXT[e.stage].label : humanize(e.outcome ?? ""))}</div></li>)} />
      </section>
    </div>
  );
}
