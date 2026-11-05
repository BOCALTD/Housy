import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { pendingSuggestions, type SummaryPayload } from "@/lib/services/ai-assist";
import { AssistantChat } from "@/components/AssistantChat";
import { STARTERS } from "@/lib/assistant-knowledge";
import { aiAuditForCompany } from "@/lib/services/ai";
import { AI_FEATURES, type AiFeature } from "@/lib/ai-rules";
import { aiProvider } from "@/lib/services/ai";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, sp, type SP } from "@/components/ui";
import { decideAction, sortDocumentsAction } from "./actions";

export const metadata = { title: "Assistant" };
export const dynamic = "force-dynamic";

export default async function AssistantPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("ai.use");
  const page = Math.max(0, Number(sp(searchParams, "page") ?? 0) || 0);
  const [pending, audit] = await Promise.all([
    pendingSuggestions(member),
    can(member.role, "ai.audit") ? aiAuditForCompany(member, page) : Promise.resolve(null),
  ]);
  const canReview = can(member.role, "ai.review");
  const connected = Boolean(aiProvider());
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Assistant</h1>
        <p className="muted">{connected ? "An AI service helps read your questions, documents and letters. Only the text you ask about is sent to it." : "No AI service is connected, so the assistant uses the platform's built-in rules."} It suggests; you decide. Nothing it suggests changes a record until a reviewer accepts it, and it never writes valuations, legal or financial figures.</p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="ai-page ai-in-workspace" aria-label="Ask the assistant">
        <AssistantChat workspace name={member.userName} starters={STARTERS.workspace} />
      </section>

      <section className="card stack" aria-labelledby="rev-h">
        <div className="row between"><h2 id="rev-h">Waiting for review ({pending.length})</h2>
          {can(member.role, "document.download") ? <form action={sortDocumentsAction}><button className="btn" type="submit">Suggest categories for unsorted documents</button></form> : null}</div>
        {pending.length === 0 ? <p className="muted">Nothing is waiting. Suggestions appear here when you sort documents or summarise a letter.</p> : (
          <div className="stack">
            {pending.slice(0, 8).map((s) => <Suggestion key={s.id} s={s} canReview={canReview} />)}
            {pending.length > 8 ? <details className="inline"><summary>Show {pending.length - 8} more</summary><div className="stack">{pending.slice(8).map((s) => <Suggestion key={s.id} s={s} canReview={canReview} />)}</div></details> : null}
          </div>
        )}
        {!canReview ? <p className="small muted">Only a manager or administrator can accept suggestions.</p> : null}
      </section>

      {audit ? (
        <section className="card stack" aria-labelledby="aud-h">
          <h2 id="aud-h">Your company&apos;s record of use</h2>
          <div className="table-wrap"><table><thead><tr><th>When</th><th>Feature</th><th>Result</th></tr></thead><tbody>
            {audit.rows.map((r) => <tr key={r.id}><td>{formatDateTime(r.createdAt)}</td><td>{AI_FEATURES[r.feature as AiFeature] ?? r.feature}</td><td><Pill status={r.status === "OK" ? "ACTIVE" : r.status === "ERROR" || r.status === "DENIED" ? "SUSPENDED" : "PENDING"} label={humanize(r.status)} /></td></tr>)}
            {audit.rows.length === 0 ? <tr><td colSpan={3} className="muted">Not used yet.</td></tr> : null}
          </tbody></table></div>
          <div className="row between">{page > 0 ? <Link className="btn" href={`/app/assistant?page=${page - 1}`}>Previous</Link> : <span />}{(page + 1) * audit.pageSize < audit.total ? <Link className="btn" href={`/app/assistant?page=${page + 1}`}>Next</Link> : <span />}</div>
        </section>
      ) : null}
    </div>
  );
}

function Suggestion({ s, canReview }: { s: Awaited<ReturnType<typeof pendingSuggestions>>[number]; canReview: boolean }) {
  const p = s.payload as Record<string, unknown>;
  const sum = p as unknown as SummaryPayload;
  const high = s.kind === "CORRESPONDENCE_SUMMARY" && sum.highImpact;
  return (
    <div className="card stack" style={{ padding: 12 }}>
      <div className="row between"><strong>{s.kind === "DOCUMENT_CATEGORY" ? `Document: ${String(p.title ?? "")}` : `Letter ${sum.reference}: ${sum.subject}`}</strong><span className="small muted">{s.source === "AI" ? "AI-assisted" : "Built-in rules"}</span></div>
      {s.kind === "DOCUMENT_CATEGORY" ? <p>Move from <b>{humanize(String(p.from))}</b> to <b>{humanize(String(p.to))}</b> ({s.confidence}% sure). <span className="muted">{String(p.why ?? "")}</span></p> : (
        <div className="stack">
          {high ? <div className="flash error" role="note">This concerns a legal or financial matter. Read the letter itself; do not rely on this summary alone.</div> : null}
          <p>{sum.summary}</p>
          {sum.asks.length ? <details className="inline"><summary>What is asked ({sum.asks.length})</summary><ul>{sum.asks.map((a) => <li key={a}>{a}</li>)}</ul></details> : null}
          {sum.dates.length || sum.amounts.length ? <p className="small">Dates: {sum.dates.join(", ") || "none"} · Amounts: {sum.amounts.join(", ") || "none"}</p> : null}
          <p className="small muted">Prepared automatically. Only dates and amounts that appear in the letter are listed.</p>
        </div>
      )}
      {canReview ? (
        <form action={decideAction} className="stack">
          <input type="hidden" name="id" value={s.id} />
          <Field label={high ? "What you checked (required)" : "Note (optional)"}><input name="note" maxLength={500} required={high} /></Field>
          <div className="row"><button className="btn primary" name="decision" value="accept" type="submit">Accept</button><button className="btn" name="decision" value="reject" type="submit">Set aside</button></div>
        </form>
      ) : null}
    </div>
  );
}
