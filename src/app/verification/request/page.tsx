import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { STATES } from "@/lib/geo-rules";
import { PROPERTY_TYPES, SERVICE_CATEGORIES } from "@/lib/verification-network-rules";
import { listingForRequest } from "@/lib/services/verification-cases";
import { requestVerificationAction } from "../actions";

export const metadata = { title: "Ask for a property verification", robots: { index: false } };
export const dynamic = "force-dynamic";

const typeWord = (t: string) => t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, " ");

export default async function RequestVerification({ searchParams: s }: { searchParams?: Promise<SP> }) {
  const searchParams = await s;
  const listingParam = sp(searchParams, "listing") ?? "";
  // Signed-out visitors sign in (or join) and come straight back here, to the same property.
  if (!(await getSession())) redirect(`/login?next=${encodeURIComponent(`/verification/request${listingParam ? `?listing=${encodeURIComponent(listingParam)}` : ""}`)}`);
  const listing = await listingForRequest(listingParam);
  return (
    <div className="wrap stack-lg vp" style={{ maxWidth: 860 }}>
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">Property verification</p>
        <h1>Ask for an independent verification</h1>
        <p className="muted">A vetted professional firm in Housy&apos;s verification network investigates the property and writes a signed report. Housy checks the report before you get it. The provider is responsible for its professional opinion.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <form action={requestVerificationAction} className="card stack vp-form">
        <input type="hidden" name="listingRef" value={listing?.ref ?? ""} />
        {listing ? <p className="small">For the listing <Link href={`/properties/${listing.ref}`}>{listing.title}</Link> ({listing.ref}). The listing&apos;s details are filled in; correct anything that is wrong.</p> : null}
        <fieldset className="vp-fs stack">
          <legend>The property</legend>
          <Field label="Address or description of where it is"><textarea name="propertyAddress" required minLength={5} maxLength={400} rows={2} defaultValue={listing?.address ?? ""} /></Field>
          <div className="grid-3">
            <Field label="State"><select name="state" required defaultValue={listing?.state ?? ""}><option value="" disabled>Choose…</option>{STATES.map((st) => <option key={st.name}>{st.name}</option>)}</select></Field>
            <Field label="Area or town" hint="Optional"><input name="area" maxLength={120} /></Field>
            <Field label="Type of property"><select name="propertyType" required defaultValue={listing?.propertyType ?? ""}><option value="" disabled>Choose…</option>{PROPERTY_TYPES.map((t) => <option key={t} value={t}>{typeWord(t)}</option>)}</select></Field>
          </div>
        </fieldset>
        <fieldset className="vp-fs stack">
          <legend>What should be checked</legend>
          <p className="small muted">Choose every check you want. Each is done by someone qualified for it; the report says what each finding rests on (documents, a registry search, a site visit or a professional opinion).</p>
          <div className="vp-checks">
            {SERVICE_CATEGORIES.map((c) => (
              <label key={c.code} className="check vp-check"><input type="checkbox" name="services" value={c.code} /><span>{c.name}<small className="muted">{c.summary}</small></span></label>
            ))}
          </div>
        </fieldset>
        <details className="vp-fold">
          <summary>More about the property and the deal (helps the provider)</summary>
          <div className="stack">
            <Field label="Documents you have" hint="For example: C of O, survey plan, deed of assignment, receipts"><textarea name="documentsAvailable" maxLength={1500} rows={2} /></Field>
            <Field label="Owner or seller" hint="Names as they appear on the documents, if you know them"><textarea name="ownerDetails" maxLength={1000} rows={2} /></Field>
            <Field label="The transaction" hint="Buying, leasing, lending against it; any deadline"><textarea name="transactionContext" maxLength={1500} rows={2} /></Field>
            <Field label="Anything else" hint="Optional"><textarea name="notes" maxLength={2000} rows={2} /></Field>
            <label className="check"><input type="checkbox" name="priority" value="URGENT" /> It is urgent (Housy will tell you if a faster turnaround is possible)</label>
          </div>
        </details>
        <p className="small muted">After you send it, Housy confirms the request and how it is paid for, then offers it to a provider qualified for these checks in the property&apos;s state. You can add documents and follow every step on the request&apos;s page.</p>
        <div className="row"><button className="btn primary" type="submit">Send the request</button><Link className="btn" href="/verification/cases">My requests</Link></div>
      </form>
    </div>
  );
}
