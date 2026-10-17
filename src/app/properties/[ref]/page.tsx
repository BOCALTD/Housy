import { Carousel } from "@/components/Carousel";
import { publicPhotosOf } from "@/lib/services/listing-photos";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { getPublicListing } from "@/lib/services/listings";
import { getFeaturedProvider, parsePrefs, shouldAutoShow } from "@/lib/services/verification";
import { listingExtras } from "@/lib/services/promotions";
import { GoldBadge, PremiumTag, PriceBlock, PromoEnds, PromoRibbon } from "@/components/Promo";
import { formatDate } from "@/lib/dates";
import { Field, Flash, HouseIcon, sp, type SP } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { isWatching } from "@/lib/services/alerts";
import { recordView, viewerKeyFor } from "@/lib/services/ads";
import { isBot } from "@/lib/ad-rules";
import { enquiryAction, watchAction } from "./actions";
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
        {photos.length > 0 ? (
          <Carousel label="Photographs of this property">
            {photos.map((ph, n) => (
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
          <PriceBlock priceKobo={listing.priceKobo} promo={extras.promo} suffix={listing.purpose !== "SALE" ? " / year" : ""} />
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
        {session ? (
          <form action={watchAction}><input type="hidden" name="ref" value={listing.publicRef} /><input type="hidden" name="on" value={watching ? "0" : "1"} />
            <button className="btn" type="submit" aria-pressed={watching}>{watching ? "Watching: stop" : "Watch this property"}</button></form>
        ) : null}
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
