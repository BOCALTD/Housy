import { requirePlatformAdmin } from "@/lib/auth";
import { partnersForAdmin, PARTNER_KINDS } from "@/lib/services/partners";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, TableMore, sp, type SP } from "@/components/ui";
import { addPartnerAction, removePartnerAction, togglePartnerAction } from "./actions";

export const metadata = { title: "Partners" };
export const dynamic = "force-dynamic";

export default async function PartnersAdmin({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const admin = await requirePlatformAdmin();
  const rows = await partnersForAdmin(admin.id);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Partners</h1>
        <p className="muted">Organisations shown in the partners slide on the home page. Add one only when a real agreement exists and you have permission to show its name and logo.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <details className="card inline"><summary>Add a partner</summary>
        <form action={addPartnerAction} className="stack">
          <Field label="Name"><input name="name" required maxLength={120} /></Field>
          <Field label="Kind"><select name="kind">{PARTNER_KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></Field>
          <Field label="Website" hint="Optional. Must start with https://"><input name="url" type="url" maxLength={300} placeholder="https://" /></Field>
          <Field label="One line about them" hint="Optional, up to 300 characters"><input name="blurb" maxLength={300} /></Field>
          <Field label="Logo" hint="PNG, JPG or WEBP, up to 1 MB"><input name="logo" type="file" accept="image/png,image/jpeg,image/webp" /></Field>
          <Field label="Order" hint="Lower numbers show first"><input name="position" type="number" min={0} max={1000} defaultValue={0} /></Field>
          <label className="check"><input type="checkbox" name="confirm" value="yes" required /> An agreement with this partner exists and they allow us to show their name and logo.</label>
          <button className="btn primary" type="submit">Add partner</button>
        </form>
      </details>
      <section className="card stack"><h2>Current partners</h2>
        {rows.length === 0 ? <p className="muted">None yet. The home page shows an invitation to partner instead.</p> : (
          <TableMore head={<tr><th>Name</th><th>Kind</th><th>Shown</th><th /></tr>} noun="more partners" rows={rows.map((p) => (
            <tr key={p.id}>
              <td><strong>{p.name}</strong>{p.url ? <div className="small muted">{p.url}</div> : null}</td>
              <td>{humanize(p.kind)}</td>
              <td><Pill status={p.active ? "ACTIVE" : "SUSPENDED"} label={p.active ? "Shown" : "Hidden"} /></td>
              <td className="row">
                <form action={togglePartnerAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="active" value={p.active ? "no" : "yes"} /><button className="btn small" type="submit">{p.active ? "Hide" : "Show"}</button></form>
                <form action={removePartnerAction}><input type="hidden" name="id" value={p.id} /><button className="btn small danger" type="submit">Remove</button></form>
              </td>
            </tr>
          ))} />
        )}
      </section>
    </div>
  );
}
