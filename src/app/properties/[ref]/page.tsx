import { CompareToggle } from "@/components/Compare";
import { CONDITIONS, CONSTRUCTION, FURNISHING, isCode, parseAmenities } from "@/lib/listing-rules";
import { labelsOf, refData } from "@/lib/services/reference";
import Link from "next/link";
import { priceSuffix } from "@/lib/listing-rules";
import { companyTrust } from "@/lib/services/kyc";
import { TrustBadge } from "@/components/TrustBadge";
import { withPublic } from "@/lib/db";
import { Carousel } from "@/components/Carousel";
import { publicPhotosOf } from "@/lib/services/listing-photos";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { getPublicListing } from "@/lib/services/listings";
import { getFeaturedProvider, parsePrefs, shouldAutoShow } from "@/lib/services/verification";
import { listingExtras } from "@/lib/services/promotions";
import { GoldBadge, PremiumTag, PriceBlock, PromoEnds, PromoRibbon } from "@/components/Promo";
import { formatDate } from "@/lib/dates";
import { formatKobo } from "@/lib/money";
import { Field, Flash, HouseIcon, sp, type SP } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { isWatching } from "@/lib/services/alerts";
import { recordView, viewerKeyFor } from "@/lib/services/ads";
import { isBot } from "@/lib/ad-rules";
import { enquiryAction, requestInspectionAction, watchAction } from "./actions";
import { VerifyModal, type ProviderView } from "./VerifyModal";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params: paramsP }: { params: Promise<{ ref: string }> }) {
  const params = await paramsP;
  const l = await getPublicListing(params.ref);
  return { title: l ? l.title : "Property not available" };
}

export default async function PropertyPage({ params: paramsP, searchParams: searchP }: { params: Promise<{ ref: string }>; searchParams?: Promise<SP> }) {
  const params = await paramsP;
  const searchParams = await searchP;
  const listing = await getPublicListing(params.ref);
  if (!listing) notFound();
  const extras = await listingExtras(listing);
  const adRef = /^AD-[A-Z0-9]{8}$/.test(sp(searchParams, "ad") ?? "") ? (sp(searchParams, "ad") as string) : null;
  const ua = (await headers()).get("user-agent") ?? "";
  // One visit per visitor per day, remembered as coming from an advert or not, so paid and organic attention can be told apart.
  if (!isBot(ua)) await recordView(listing.id, viewerKeyFor((await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local", ua), adRef).catch(() => undefined);
  const session = await getSession();
  const photos = await publicPhotosOf(listing.id);
  const naira = (k: bigint | null) => (k == null ? "" : String(k / 100n));
  const calcHref = listing.purpose === "SALE"
    ? `/calculators?tab=purchase&price=${naira(listing.priceKobo)}`
    : `/calculators?tab=movein&yearlyRent=${naira(listing.pricePeriod === "MONTH" ? listing.priceKobo * 12n : listing.priceKobo)}${listing.serviceChargeKobo != null ? `&serviceCharge=${naira(listing.serviceChargeKobo)}` : ""}`;
  const ref = await refData();
  const pics = photos.filter((p) => p.kind !== "FLOOR_PLAN");
  const plans = photos.filter((p) => p.kind === "FLOOR_PLAN");
  const [trust, company] = await Promise.all([companyTrust(listing.companyId), withPublic((tx) => tx.companyProfile.findFirst({ where: { companyId: listing.companyId, listed: true }, select: { displayName: true } }))]);
  const watching = session ? await isWatching(session.user.id, listing.id) : false;
  const provider = await getFeaturedProvider();
  const prefs = parsePrefs((await cookies()).get("pv_pref")?.value);
  const autoOpen = !!provider && shouldAutoShow(prefs, listing.purpose) && !sp(searchParams, "notice");
  const providerView: ProviderView | null = provider ? {
    id: provider.id, name: provider.name, shortName: provider.shortName, profile: provider.profile,
    services: provider.services.split("\n").map((s) => s.trim()).filter(Boolean),
    coverage: provider.coverage, link: provider.link, placement: provider.placement,
  } : null;

  return (
    <div className="two">
      <article className="card stack">
        {pics.length > 0 ? (
          <Carousel label="Photographs of this property">
            {pics.map((ph, n) => (
              <figure key={ph.id} className="shot">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/photos/${ph.id}`} alt={ph.caption || `${listing.title}, photograph ${n + 1}`} loading={n === 0 ? "eager" : "lazy"} decoding="async" />
                {ph.caption ? <figcaption className="small muted">{ph.caption}</figcaption> : null}
              </figure>
            ))}
          </Carousel>
        ) : <div className="prop-img" style={{ borderRadius: 10 }}><HouseIcon /></div>}
        {extras.promo ? <div className="promo-tags"><PromoRibbon name={extras.promo.campaignName} pct={extras.promo.pct} theme={extras.promo.theme} /><PromoEnds endsOn={extras.promo.endsOn} /></div> : null}
        <div className="row">
          <PremiumTag tier={extras.tier} /><GoldBadge tier={extras.tier} />
          <span className="pill brand">{listing.purpose === "SALE" ? "For sale" : `For ${listing.purpose.toLowerCase()}`}</span>
          <span className="pill disc mono">{listing.publicRef}</span>
        </div>
        <h1>{listing.title}</h1>
        <p className="price" style={{ fontSize: 26 }}>
          <PriceBlock priceKobo={listing.priceKobo} promo={extras.promo} suffix={priceSuffix(listing.pricePeriod)} />
        </p>
        <p className="muted">
          {[listing.bedrooms != null ? `${listing.bedrooms} bedrooms` : null, listing.bathrooms != null ? `${listing.bathrooms} bathrooms` : null,
            `${listing.city}, ${listing.state}`].filter(Boolean).join(" · ")}
        </p>
        {listing.description ? <p style={{ whiteSpace: "pre-line", maxWidth: "65ch" }}>{listing.description}</p> : null}
        {(() => {
          const money = (k: bigint | null) => (k == null ? null : formatKobo(k));
          const rows: [string, string | null][] = [
            ["Type", listing.propertyType !== "OTHER" ? labelsOf(ref, "PROPERTY_TYPE")[listing.propertyType] ?? null : null],
            ["Price", `${formatKobo(listing.priceKobo)}${priceSuffix(listing.pricePeriod)}${listing.negotiable ? " (negotiable)" : ""}`],
            ["Caution deposit", money(listing.depositKobo)],
            ["Service charge", listing.serviceChargeKobo != null ? `${formatKobo(listing.serviceChargeKobo)} / year` : null],
            ["Other fees", listing.feesNote || null],
            ["Building size", listing.buildingSqm != null ? `${listing.buildingSqm.toLocaleString("en-NG")} m²` : null],
            ["Land size", listing.landSqm != null ? `${listing.landSqm.toLocaleString("en-NG")} m²` : null],
            ["Plot", listing.plotDimensions || null],
            ["Floors", listing.floors != null ? String(listing.floors) : null],
            ["Toilets", listing.toilets != null ? String(listing.toilets) : null],
            ["Furnishing", listing.furnishing !== "UNSPECIFIED" && isCode(FURNISHING, listing.furnishing) ? FURNISHING[listing.furnishing] : null],
            ["Condition", listing.condition !== "UNSPECIFIED" && isCode(CONDITIONS, listing.condition) ? CONDITIONS[listing.condition] : null],
            ["Construction", isCode(CONSTRUCTION, listing.constructionStatus) ? CONSTRUCTION[listing.constructionStatus] : null],
            ["Serviced", listing.serviced ? "Yes" : null],
            ["Available from", listing.availableFrom ? formatDate(listing.availableFrom) : null],
            ["Minimum lease", listing.minLeaseMonths != null ? `${listing.minLeaseMonths} months` : null],
            ["Estate or development", listing.estateName || null],
            ["Title document (as stated by the company, not verified)", listing.titleDocument !== "UNSPECIFIED" ? labelsOf(ref, "TITLE_DOCUMENT")[listing.titleDocument] ?? null : null],
          ];
          const amenityLabels = labelsOf(ref, "AMENITY");
          const amenities = parseAmenities(listing.amenities, Object.keys(amenityLabels));
          return (
            <section className="stack" aria-labelledby="details-h">
              <h2 id="details-h">Details</h2>
              <dl className="spec">{rows.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
              {amenities.length ? <><h3>Features</h3><ul className="chips">{amenities.map((a) => <li key={a}>{amenityLabels[a]}</li>)}</ul></> : null}
              {plans.length ? (
                <details className="inline"><summary>Floor plans ({plans.length})</summary>
                  <div className="stack">{plans.map((ph, n) => (
                    <figure key={ph.id} className="shot" style={{ margin: 0 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/photos/${ph.id}`} alt={ph.caption || `Floor plan ${n + 1}`} loading="lazy" decoding="async" style={{ objectFit: "contain", background: "#fff" }} />
                      {ph.caption ? <figcaption className="small muted">{ph.caption}</figcaption> : null}
                    </figure>
                  ))}</div>
                </details>
              ) : null}
              {listing.videoUrl ? <p><a className="btn" href={listing.videoUrl} target="_blank" rel="noopener noreferrer">Watch the video tour (opens YouTube or Vimeo)</a></p> : null}
            </section>
          );
        })()}
        <div className="flash" style={{ background: "var(--surface-2)" }}>
          <strong>What has been checked:</strong> this listing was submitted by a registered company and reviewed by the platform
          before publication{listing.publishedAt ? ` on ${formatDate(listing.publishedAt)}` : ""}. Title and ownership have <strong>not</strong> been verified by the platform.
          {" "}<Link href={`/trust?category=SUSPICIOUS_LISTING&targetKind=LISTING&targetRef=${listing.publicRef}`}>Report this listing</Link>.
          {providerView ? <> <VerifyModal provider={providerView} listingRef={listing.publicRef} autoOpen={autoOpen} /></> : null}
        </div>
      </article>

      <aside className="card stack">
        <div className="row">
          <CompareToggle refId={listing.publicRef} />
          <Link className="btn" href={calcHref}>{listing.purpose === "SALE" ? "Work out buying costs" : "Work out move-in costs"}</Link>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <p className="eyebrow">Listed by</p>
          {company ? <Link className="tap" href={`/companies/${listing.companyId}`}><strong>{company.displayName}</strong></Link> : <strong>A registered company</strong>}
          <TrustBadge t={trust} full />
        </div>
        {session ? (
          <form action={watchAction}><input type="hidden" name="ref" value={listing.publicRef} /><input type="hidden" name="on" value={watching ? "0" : "1"} />
            <button className="btn" type="submit" aria-pressed={watching}>{watching ? "Watching: stop" : "Watch this property"}</button></form>
        ) : null}
        <details className="inline" open={false}>
          <summary>Request an inspection</summary>
          {session ? (
            <form action={requestInspectionAction} className="stack">
              <input type="hidden" name="ref" value={listing.publicRef} />
              <label className="field">Your name<input name="name" required maxLength={120} defaultValue={session.user.name} autoComplete="name" /></label>
              <label className="field">Phone (optional)<input name="phone" maxLength={30} inputMode="tel" autoComplete="tel" /><small>Shared only with the company for this inspection.</small></label>
              <label className="field">Preferred date and time<input name="preferredAt" type="datetime-local" required /><small>Lagos time.</small></label>
              <label className="field">Second choice (optional)<input name="alternativeAt" type="datetime-local" /></label>
              <label className="field">Anything they should know (optional)<textarea name="message" rows={2} maxLength={1000} /></label>
              <button className="btn primary" type="submit">Request inspection</button>
              <p className="small muted">Never pay anything before you have inspected the property. You can turn on a safety session for the visit.</p>
            </form>
          ) : <p className="small"><Link href="/login">Sign in</Link> to request an inspection.</p>}
        </details>
        <h2>Send an enquiry</h2>
        <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
        <form action={enquiryAction} className="stack">
          <input type="hidden" name="ref" value={listing.publicRef} />
          {adRef ? <input type="hidden" name="ad" value={adRef} /> : null}
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
