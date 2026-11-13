import { Field, Flash, sp, type SP } from "@/components/ui";
import { providerDocuments } from "@/lib/services/verification-network";
import { DOC_KINDS, vpCan } from "@/lib/verification-network-rules";
import { OrgHeader, orgFor } from "../shared";
import { addDocAction, removeDocAction } from "../../actions";

export const metadata = { title: "Documents", robots: { index: false } };
export const dynamic = "force-dynamic";

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default async function ProviderDocs({ params: p, searchParams: s }: { params: Promise<{ code: string }>; searchParams?: Promise<SP> }) {
  const { code } = await p;
  const searchParams = await s;
  const ctx = await orgFor(code);
  const docs = await providerDocuments(ctx);
  const manage = vpCan(ctx.role, "org.documents") && ctx.active;
  const now = new Date(), soon = new Date(Date.now() + 60 * 864e5);
  return (
    <div className="wrap stack-lg vp">
      <OrgHeader ctx={ctx} title="Documents" />
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card stack">
        <h2>On file ({docs.length})</h2>
        <p className="small muted">Documents sent with the application are kept as part of Housy&apos;s record and cannot be removed here. Add renewed licences when old ones expire.</p>
        {docs.length ? <ul className="vp-docs">{docs.map((d) => (
          <li key={d.id}>
            <span><strong>{d.title}</strong><span className="small muted">{DOC_KINDS.find((k) => k[0] === d.kind)?.[1]} · {d.fileName} · {kb(d.sizeBytes)}{d.expiresOn ? <> · <span className={d.expiresOn < now ? "bad-text" : d.expiresOn < soon ? "warn-text" : ""}>{d.expiresOn < now ? "expired" : "valid until"} {d.expiresOn.toISOString().slice(0, 10)}</span></> : null}</span></span>
            <span className="row"><a className="btn small" href={`/verification-partners/doc/${d.id}`} target="_blank" rel="noopener">Open</a>
              {manage ? <form action={removeDocAction}><input type="hidden" name="code" value={ctx.code} /><input type="hidden" name="id" value={d.id} /><button className="btn small" type="submit" data-confirm="Remove this document?" data-confirm-body="It comes off the organisation's file." data-confirm-ok="Remove">Remove</button></form> : null}</span>
          </li>
        ))}</ul> : <p className="muted">None yet.</p>}
      </section>
      {manage ? (
        <form action={addDocAction} className="card stack" encType="multipart/form-data">
          <input type="hidden" name="code" value={ctx.code} />
          <h2>Add a document</h2>
          <div className="grid-3">
            <Field label="Kind"><select name="kind" required defaultValue=""><option value="" disabled>Choose…</option>{DOC_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Title" hint="Optional"><input name="title" maxLength={160} /></Field>
            <Field label="Valid until" hint="For licences and certificates"><input type="date" name="expiresOn" /></Field>
          </div>
          <Field label="File" hint="PDF, JPG, PNG, WEBP or Word, up to 4 MB"><input type="file" name="file" required accept="application/pdf,image/png,image/jpeg,image/webp,.docx" /></Field>
          <div className="row"><button className="btn primary" type="submit">Add document</button></div>
        </form>
      ) : null}
    </div>
  );
}
