import { Field, Flash, sp, type SP } from "@/components/ui";
import { providerProfile, serviceCategories } from "@/lib/services/verification-network";
import { vpCan } from "@/lib/verification-network-rules";
import { OrgHeader, orgFor } from "../shared";
import { saveCoverageAction, saveProfileAction, saveServicesAction } from "../../actions";

export const metadata = { title: "Profile and services", robots: { index: false } };
export const dynamic = "force-dynamic";

const naira = (k: bigint | null) => (k === null ? "" : String(Number(k) / 100));

export default async function ProviderProfilePage({ params: p, searchParams: s }: { params: Promise<{ code: string }>; searchParams?: Promise<SP> }) {
  const { code } = await p;
  const searchParams = await s;
  const ctx = await orgFor(code);
  const [pr, cats] = await Promise.all([providerProfile(ctx), serviceCategories(false)]);
  const canProfile = vpCan(ctx.role, "org.profile") && ctx.active, canServices = vpCan(ctx.role, "org.services") && ctx.active;
  const allowed = cats.filter((c) => pr.allowedServices.includes(c.code));
  return (
    <div className="wrap stack-lg vp">
      <OrgHeader ctx={ctx} title="Profile, services and coverage" />
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="card stack">
        <h2>Housy&apos;s record</h2>
        <p className="small muted">Set when Housy approved the organisation. To change any of it, contact Housy.</p>
        <dl className="vp-dl">
          <dt>Registered name</dt><dd>{pr.legalName || "—"}</dd>
          <dt>CAC number</dt><dd>{pr.cacNumber || "—"}</dd>
          <dt>Provider ID</dt><dd>{pr.providerCode}</dd>
          <dt>Approved for</dt><dd>{allowed.map((c) => c.name).join("; ") || "No services yet"} · {pr.allowedStates.length} state{pr.allowedStates.length === 1 ? "" : "s"}</dd>
        </dl>
      </section>

      <form action={saveProfileAction} className="card stack" encType="multipart/form-data">
        <input type="hidden" name="code" value={ctx.code} />
        <h2>Public profile</h2>
        <fieldset disabled={!canProfile} className="stack vp-fs-plain">
          <div className="grid-2">
            <Field label="Name customers see"><input name="name" required maxLength={160} defaultValue={pr.name} /></Field>
            <Field label="Short name"><input name="shortName" required maxLength={40} defaultValue={pr.shortName} /></Field>
            <Field label="Contact email"><input name="contactEmail" type="email" required maxLength={200} defaultValue={pr.contactEmail} /></Field>
            <Field label="Contact telephone"><input name="contactPhone" type="tel" required maxLength={30} defaultValue={pr.contactPhone} /></Field>
          </div>
          <Field label="Website" hint="Optional; https:// only"><input name="link" type="url" maxLength={300} defaultValue={pr.link} placeholder="https://" /></Field>
          <Field label="About the organisation"><textarea name="profile" required minLength={40} maxLength={3000} rows={5} defaultValue={pr.profile} /></Field>
          <Field label="Logo" hint="PNG, JPG or WEBP, up to 1 MB. Leave empty to keep the current one"><input type="file" name="logo" accept="image/png,image/jpeg,image/webp" /></Field>
          {canProfile ? <div className="row"><button className="btn primary" type="submit">Save profile</button></div> : <p className="small muted">{ctx.active ? "Only the organisation's owner can change the profile." : "The organisation is suspended: nothing can be changed."}</p>}
        </fieldset>
      </form>

      <form action={saveServicesAction} className="card stack" id="services">
        <input type="hidden" name="code" value={ctx.code} />
        <h2>Services, prices and turnaround</h2>
        {allowed.length === 0 ? <p className="muted">Housy has not approved the organisation for any service yet.</p> : (
          <fieldset disabled={!canServices} className="stack vp-fs-plain">
            <ul className="vp-svc">{allowed.map((c) => {
              const o = pr.offerings.find((x) => x.categoryCode === c.code);
              return (
                <li key={c.code} className="vp-svc-row">
                  <input type="hidden" name={`svc.${c.code}.present`} value="1" />
                  <label className="check"><input type="checkbox" name={`svc.${c.code}.active`} value="yes" defaultChecked={o?.active ?? false} /> <strong>{c.name}</strong></label>
                  <div className="grid-3">
                    <Field label="Price (₦)" hint="Leave empty to quote per case"><input name={`svc.${c.code}.price`} inputMode="decimal" defaultValue={naira(o?.priceKobo ?? null)} /></Field>
                    <Field label="Turnaround (days)"><input name={`svc.${c.code}.days`} type="number" inputMode="numeric" min={1} max={180} defaultValue={o?.turnaroundDays ?? 10} /></Field>
                    <Field label="Notes" hint="Optional"><input name={`svc.${c.code}.notes`} maxLength={500} defaultValue={o?.notes} /></Field>
                  </div>
                </li>
              );
            })}</ul>
            {canServices ? <div className="row"><button className="btn primary" type="submit">Save services</button></div> : null}
          </fieldset>
        )}
      </form>

      <form action={saveCoverageAction} className="card stack" id="coverage">
        <input type="hidden" name="code" value={ctx.code} />
        <h2>Where you work</h2>
        <fieldset disabled={!canServices} className="stack vp-fs-plain">
          <div className="vp-checks vp-states">{pr.allowedStates.map((st) => <label key={st} className="check"><input type="checkbox" name="states" value={st} defaultChecked={pr.coverage.some((c) => c.state === st)} /> {st}</label>)}</div>
          {pr.allowedStates.length === 0 ? <p className="muted">Housy has not approved the organisation for any state yet.</p> : canServices ? <div className="row"><button className="btn primary" type="submit">Save coverage</button></div> : null}
        </fieldset>
      </form>
    </div>
  );
}
