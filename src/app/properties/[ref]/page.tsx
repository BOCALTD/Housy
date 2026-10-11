import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getPublicListing } from "@/lib/services/listings";
import { getFeaturedProvider, parsePrefs, shouldAutoShow } from "@/lib/services/verification";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Field, Flash, HouseIcon, sp, type SP } from "@/components/ui";
import { enquiryAction } from "./actions";
import { VerifyModal, type ProviderView } from "./VerifyModal";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { ref: string } }) {
  const l = await getPublicListing(params.ref);
  return { title: l ? l.title : "Property not available" };
}

export default async function PropertyPage({ params, searchParams }: { params: { ref: string }; searchParams?: SP }) {
  const listing = await getPublicListing(params.ref);
  if (!listing) notFound();
  const provider = await getFeaturedProvider();
  const prefs = parsePrefs(cookies().get("pv_pref")?.value);
  const autoOpen = !!provider && shouldAutoShow(prefs, listing.purpose) && !sp(searchParams, "notice");
  const providerView: ProviderView | null = provider ? {
    id: provider.id, name: provider.name, shortName: provider.shortName, profile: provider.profile,
    services: provider.services.split("\n").map((s) => s.trim()).filter(Boolean),
    coverage: provider.coverage, link: provider.link, placement: provider.placement,
  } : null;

  return (
    <div className="two">
      <article className="card stack">
        <div className="prop-img" style={{ borderRadius: 10 }}><HouseIcon /></div>
        <div className="row">
          <span className="pill brand">{listing.purpose === "SALE" ? "For sale" : `For ${listing.purpose.toLowerCase()}`}</span>
          <span className="pill disc mono">{listing.publicRef}</span>
        </div>
        <h1>{listing.title}</h1>
        <p className="price" style={{ fontSize: 26 }}>
          {formatKobo(listing.priceKobo)}{listing.purpose !== "SALE" ? <span className="small muted"> / year</span> : null}
        </p>
        <p className="muted">
          {[listing.bedrooms != null ? `${listing.bedrooms} bedrooms` : null, listing.bathrooms != null ? `${listing.bathrooms} bathrooms` : null,
            `${listing.city}, ${listing.state}`].filter(Boolean).join(" · ")}
        </p>
        {listing.description ? <p style={{ whiteSpace: "pre-line", maxWidth: "65ch" }}>{listing.description}</p> : null}
        <div className="flash" style={{ background: "var(--surface-2)" }}>
          <strong>What has been checked:</strong> this listing was submitted by a registered company and reviewed by the platform
          before publication{listing.publishedAt ? ` on ${formatDate(listing.publishedAt)}` : ""}. Title and ownership have <strong>not</strong> been verified by the platform.
          {providerView ? <> <VerifyModal provider={providerView} listingRef={listing.publicRef} autoOpen={autoOpen} /></> : null}
        </div>
      </article>

      <aside className="card stack">
        <h2>Send an enquiry</h2>
        <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
        <form action={enquiryAction} className="stack">
          <input type="hidden" name="ref" value={listing.publicRef} />
          <Field label="Your name"><input name="name" id="enqName" required autoComplete="name" /></Field>
          <Field label="Phone or email"><input name="contact" id="enqContact" required /></Field>
          <Field label="Message"><textarea name="message" id="enqMessage" rows={4} required defaultValue={`I am interested in ${listing.publicRef}. Is it still available?`} /></Field>
          <p className="small muted">Your details go only to the company that listed this property.</p>
          <button className="btn primary" type="submit">Send enquiry</button>
        </form>
      </aside>
    </div>
  );
}
