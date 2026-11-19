import { requirePlatformAdmin } from "@/lib/auth";
import { adminBanners, BANNER_FOLD_LABELS, BANNER_FOLDS, BANNER_PLACE_LABELS, BANNER_PLACES, promoLayoutOn } from "@/lib/services/banners";
import { formatDate, toDateOnlyString } from "@/lib/dates";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { ToggleSwitch } from "@/components/ToggleSwitch";
import { PromoBanner } from "@/components/PromoBanner";
import { bannerActiveAction, layoutAction, moveBannerAction, removeBannerAction, saveBannerAction } from "./actions";

export const metadata = { title: "Promo banners" };
export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof adminBanners>>[number];

function BannerForm({ b }: { b?: Row }) {
  return (
    <form action={saveBannerAction} className="stack">
      {b ? <input type="hidden" name="id" value={b.id} /> : null}
      <div className="fields">
        <Field label={b ? "New picture (optional)" : "Banner picture"} hint="JPG, PNG or WebP, up to 4 MB, at least 600 × 150. 1600 × 500 looks sharp on most screens. It is saved as WebP.">
          <input type="file" name="desktop" accept="image/jpeg,image/png,image/webp" required={!b} />
        </Field>
        <Field label="Phone version (optional)" hint="A taller design for phones, for example 1080 × 1080. Without one, phones show the main picture.">
          <input type="file" name="mobile" accept="image/jpeg,image/png,image/webp" />
        </Field>
      </div>
      {b?.mobileW ? <label className="check"><input type="checkbox" name="dropMobile" /> Remove the phone version</label> : null}
      <Field label="What the banner says" hint="Read out to people who cannot see it, and shown if the picture cannot load."><input name="title" required minLength={3} maxLength={160} defaultValue={b?.title} placeholder="Festive sale: up to 30% off homes in Lekki" /></Field>
      <Field label="Opens when tapped (optional)" hint="A page on this site, such as /search?city=Lekki, or a full https:// address."><input name="linkUrl" maxLength={500} defaultValue={b?.linkUrl} inputMode="url" /></Field>
      <fieldset className="field"><legend>Shows</legend>
        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          {BANNER_PLACES.map((p) => <label key={p} className="check"><input type="checkbox" name="places" value={p} defaultChecked={b ? b.places.includes(p) : p === "HOME"} /> {BANNER_PLACE_LABELS[p]}</label>)}
        </div>
      </fieldset>
      <div className="fields">
        <Field label="Folded corner"><select name="fold" defaultValue={b?.fold ?? "BOTTOM_RIGHT"}>{BANNER_FOLDS.map((f) => <option key={f} value={f}>{BANNER_FOLD_LABELS[f]}</option>)}</select></Field>
        <Field label="From (optional)"><input type="date" name="startsAt" defaultValue={b?.startsAt ? toDateOnlyString(b.startsAt) : ""} /></Field>
        <Field label="Until (optional)"><input type="date" name="endsAt" defaultValue={b?.endsAt ? toDateOnlyString(b.endsAt) : ""} /></Field>
      </div>
      <label className="check"><input type="checkbox" name="float" defaultChecked={b ? b.float : true} /> Float gently (not shown to people who prefer less motion)</label>
      <div><button className="btn primary" type="submit" data-confirm={b ? "Save this banner?" : "Upload and add this banner?"} data-confirm-body={b ? "Changes show on the site straight away." : "It shows in the places you chose straight away, while the promo layout is on."} data-confirm-ok={b ? "Save" : "Upload"} data-confirm-tone="default">{b ? "Save banner" : "Add banner"}</button></div>
    </form>
  );
}

/** The platform administrator designs banners elsewhere and posts them here; one switch turns the whole promo layout on or off. */
export default async function BannersPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const admin = await requirePlatformAdmin();
  const [on, banners] = await Promise.all([promoLayoutOn(), adminBanners(admin.id)]);
  const now = new Date();
  const state = (b: Row) => !b.active ? { s: "SUSPENDED", l: "Hidden" } : b.startsAt && b.startsAt > now ? { s: "PENDING", l: `From ${formatDate(b.startsAt)}` } : b.endsAt && b.endsAt < now ? { s: "DONE", l: "Ended" } : { s: "ACTIVE", l: "Showing" };
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Promo banners</h1>
        <p className="muted">Design a banner in Canva, Photoshop or any design tool, export it as a picture and post it here. Housy shows it with a folded corner and a gentle float on the homepage, above search results or on dashboards.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="card stack" aria-labelledby="layout-h">
        <h2 id="layout-h">Promo layout</h2>
        <ToggleSwitch on={on} action={layoutAction} label="Promo layout" confirm={on
          ? { title: "Switch the promo layout off?", body: "No banners or festive offers show anywhere. Promotion prices on properties stay. You can switch it back on at any time.", ok: "Switch off" }
          : { title: "Switch the promo layout on?", body: "Banners that are showing and the festive offers appear again straight away.", ok: "Switch on" }} />
        <p className="small muted">{on ? "On: banners below that are showing appear in their places, and the homepage shows the festive offers." : "Off: no banners or festive offers show. Promotion prices on properties still apply."}</p>
      </section>

      <section className="card stack" aria-labelledby="new-h">
        <details className="inline" open={banners.length === 0}><summary id="new-h">Add a banner</summary><BannerForm /></details>
      </section>

      <section className="card stack" aria-labelledby="list-h">
        <h2 id="list-h">Banners ({banners.length})</h2>
        {banners.length === 0 ? <p className="muted">No banners yet.</p> : (
          <ShowMore noun="more banners" limit={4} items={banners.map((b, k) => {
            const st = state(b);
            return (
              <li key={b.id}><div className="stack" style={{ width: "100%", gap: 10 }}>
                <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
                  <div><strong>{b.title}</strong> <span className="small muted">{b.places.map((p) => BANNER_PLACE_LABELS[p as keyof typeof BANNER_PLACE_LABELS]).join(", ")}{b.mobileW ? " · with phone version" : ""}{b.endsAt ? ` · until ${formatDate(b.endsAt)}` : ""}</span></div>
                  <Pill status={st.s} label={st.l} />
                </div>
                <PromoBanner banners={[{ id: b.id, title: b.title, linkUrl: "", fold: b.fold, float: false, desktopW: b.desktopW, desktopH: b.desktopH, mobileW: b.mobileW, mobileH: b.mobileH, v: b.updatedAt.getTime() }]} slim />
                <div className="row" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <ToggleSwitch on={b.active} action={bannerActiveAction} label="Show" hidden={{ id: b.id }} confirm={b.active ? { title: "Hide this banner?", body: "It stops showing everywhere until you show it again.", ok: "Hide" } : { title: "Show this banner?", body: "It shows in its places straight away while the promo layout is on.", ok: "Show" }} />
                  {k > 0 ? <form action={moveBannerAction}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="dir" value="up" /><button className="btn small" type="submit" aria-label={`Move "${b.title}" earlier`}>Earlier</button></form> : null}
                  {k < banners.length - 1 ? <form action={moveBannerAction}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="dir" value="down" /><button className="btn small" type="submit" aria-label={`Move "${b.title}" later`}>Later</button></form> : null}
                  <form action={removeBannerAction}><input type="hidden" name="id" value={b.id} /><button className="btn small danger" type="submit" data-confirm="Remove this banner?" data-confirm-body="It stops showing straight away. You can undo this for a short while." data-confirm-ok="Remove">Remove</button></form>
                </div>
                <details className="inline"><summary>Change</summary><BannerForm b={b} /></details>
              </div></li>
            );
          })} />
        )}
      </section>
    </div>
  );
}
