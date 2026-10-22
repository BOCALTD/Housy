import { requirePlatformAdmin } from "@/lib/auth";
import { CAN_ADD, REF_KINDS, refData, type RefKind } from "@/lib/services/reference";
import { Flash, Pill, sp, type SP } from "@/components/ui";
import { saveReferenceAction } from "./actions";

export const metadata = { title: "Reference data" };
export const dynamic = "force-dynamic";

const TITLES: Record<RefKind, string> = { PROPERTY_TYPE: "Property types", AMENITY: "Amenities and features", TITLE_DOCUMENT: "Title and property documents" };

export default async function ReferenceAdmin({ searchParams }: { searchParams?: Promise<SP> }) {
  const s = await searchParams;
  await requirePlatformAdmin();
  const d = await refData(0);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Reference data</h1><p className="muted">The lists companies choose from and visitors filter by. Rename, hide or reorder any value; add amenities and documents, optionally for one country only (for example a document used only in Ghana). Hiding a value keeps it on listings that already use it.</p></div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      {REF_KINDS.map((kind) => (
        <details key={kind} id={kind} className="card inline">
          <summary>{TITLES[kind]} ({d[kind].filter((x) => x.active).length} shown)</summary>
          <div className="stack">
            <ul className="kyc-list">
              {d[kind].map((x) => (
                <li key={x.code}>
                  <form action={saveReferenceAction} className="ref-row">
                    <input type="hidden" name="kind" value={kind} /><input type="hidden" name="code" value={x.code} />
                    <code className="small">{x.code}</code>
                    <label className="field">Label<input name="label" defaultValue={x.label} maxLength={80} required /></label>
                    <label className="field">Order<input name="position" type="number" min={0} max={1000} defaultValue={x.position} /></label>
                    <label className="field">Country<input name="country" maxLength={2} defaultValue={x.country} placeholder="All" /></label>
                    <label className="check"><input type="checkbox" name="active" value="yes" defaultChecked={x.active} /> Shown</label>
                    {x.custom ? <Pill status="PENDING" label="Added" /> : null}
                    <button className="btn small" type="submit">Save</button>
                  </form>
                </li>
              ))}
            </ul>
            {CAN_ADD[kind] ? (
              <form action={saveReferenceAction} className="card stack">
                <h3>Add to {TITLES[kind].toLowerCase()}</h3>
                <input type="hidden" name="kind" value={kind} /><input type="hidden" name="active" value="yes" />
                <div className="fields">
                  <label className="field">Code<input name="code" required maxLength={40} placeholder="E.g. SECURITY_DOGS" /></label>
                  <label className="field">Label<input name="label" required maxLength={80} /></label>
                  <label className="field">Country (optional)<input name="country" maxLength={2} placeholder="NG" /></label>
                  <label className="field">Order<input name="position" type="number" min={0} max={1000} defaultValue={500} /></label>
                </div>
                <button className="btn primary" type="submit">Add</button>
              </form>
            ) : <p className="small muted">New property types need a software change, because search categories depend on them.</p>}
          </div>
        </details>
      ))}
    </div>
  );
}
