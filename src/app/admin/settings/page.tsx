import Link from "next/link";
import { headers } from "next/headers";
import { requirePlatformAdmin } from "@/lib/auth";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { CAPTCHA_PLACES, CAPTCHA_PLACE_LABELS, COMMISSION_KINDS, COMMISSION_LABELS, LIVE_CHAT_ID_HINTS, LIVE_CHAT_LABELS, LIVE_CHAT_PLACES, LIVE_CHAT_PLACE_LABELS, LIVE_CHAT_PROVIDERS, configForAdmin, watermarkCounts } from "@/lib/services/platform-config";
import { captchaAction, cloudflareAction, commissionAction, endMaintenanceAction, maintenanceAction, liveChatAction, paystackAction, watermarkPositionAction, watermarkSwitchAction, routesAction, stripeAction } from "./actions";
import { COUNTRIES, COUNTRY_CODES, providerCanServe } from "@/lib/regions";
import { maintenanceNow } from "@/lib/services/maintenance-mode";
import { formatDateTime, toLagosLocal, zoneLabel } from "@/lib/dates";

export const metadata = { title: "Platform settings" };
export const dynamic = "force-dynamic";

export default async function PlatformSettings({ searchParams: s }: { searchParams?: Promise<SP> }) {
  const searchParams = await s;
  await requirePlatformAdmin();
  const [c, m, wm] = await Promise.all([configForAdmin(), maintenanceNow(), watermarkCounts()]);
  const w = m.window;
  const soon = toLagosLocal(new Date(Date.now() + 25 * 3_600_000));
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  return (
    <div className="stack-lg settings-page">
      <div className="stack" style={{ gap: 6 }}>
        <Link className="small" href="/admin">Administration</Link>
        <h1>Platform settings</h1>
        <p className="muted">Upgrades and maintenance, payments, the photo watermark, live chat, the check that visitors are people, Cloudflare, and Housy&apos;s commission. Secret keys are stored encrypted and never shown again in full.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="card stack" aria-labelledby="maint-h">
        <h2 id="maint-h">Upgrades and maintenance</h2>
        {w ? (
          <div className="stack" style={{ gap: 8 }}>
            <p>
              {m.phase === "active" ? <span className="pill warn">On now</span> : <span className="pill">Scheduled</span>}{" "}
              {formatDateTime(w.start)} to {formatDateTime(w.end)} ({zoneLabel(w.start)}){w.emergency ? " · emergency" : ""}
            </p>
            <p className="small muted">{w.notifiedAt ? `Everyone was told on ${formatDateTime(w.notifiedAt)}, in the app and by email.` : m.phase === "scheduled" ? `Everyone is told in the app and by email 24 hours before it starts (${formatDateTime(new Date(w.start.getTime() - 86_400_000))}).` : "The notice is going out now."}</p>
            {w.message ? <p className="small">“{w.message}”</p> : null}
            <form action={endMaintenanceAction} className="row">
              <button className="btn danger" type="submit" data-confirm={m.phase === "active" ? "End maintenance now?" : "Cancel the planned maintenance?"} data-confirm-body={m.phase === "active" ? "The site opens to everyone again straight away." : w.notifiedAt ? "Everyone who was told gets a notice in the app that it is cancelled." : "Nobody has been told yet."} data-confirm-ok={m.phase === "active" ? "End maintenance" : "Cancel it"}>{m.phase === "active" ? "End maintenance now" : "Cancel it"}</button>
            </form>
          </div>
        ) : <p className="small muted">Nothing scheduled. During maintenance, visitors see a “back soon” page; you can still sign in and check the site. Payment messages from Paystack, scheduled jobs and the health check keep working.</p>}
        {m.phase !== "active" ? (
          <details className="vp-fold" open={!w}>
            <summary>{w ? "Change the time" : "Schedule maintenance"}</summary>
            <form action={maintenanceAction} className="stack">
              <div className="fields">
                <Field label={`Starts (${zoneLabel()})`} hint="At least 24 hours from now"><input type="datetime-local" name="start" required defaultValue={w ? toLagosLocal(w.start) : soon} /></Field>
                <Field label={`Ends (${zoneLabel()})`} hint="Up to 72 hours later"><input type="datetime-local" name="end" required defaultValue={w ? toLagosLocal(w.end) : toLagosLocal(new Date(Date.now() + 27 * 3_600_000))} /></Field>
              </div>
              <Field label="Message for everyone" hint="Optional, for example what is being improved"><textarea name="message" rows={2} maxLength={500} defaultValue={w?.message ?? ""} /></Field>
              <label className="check"><input type="checkbox" name="emergency" value="1" /><span>Emergency: it may start sooner than 24 hours (everyone is told at once)</span></label>
              <div className="row"><button className="btn primary" type="submit" data-confirm="Schedule this maintenance?" data-confirm-body="Everyone gets a notice in the app and by email 24 hours before it starts (at once for an emergency). During it, only administrators can use the site." data-confirm-ok="Schedule" data-confirm-tone="default">Schedule</button></div>
            </form>
          </details>
        ) : null}
      </section>

      <section className="card stack">
        <h2>Online payments (Paystack)</h2>
        <p>
          {c.paystack.source === "none" ? <span className="pill warn">Not connected</span> : <span className={`pill ${c.paystack.mode === "live" ? "ok" : "warn"}`}>{c.paystack.mode === "live" ? "Live" : "Test mode: no real money moves"}</span>}{" "}
          {c.paystack.source === "server" ? <span className="small muted">Using the key set on the server, which takes priority over anything saved here.</span> : c.paystack.source === "settings" ? <span className="small muted">Secret key saved here, ending {c.paystack.secretTail}.</span> : <span className="small muted">Until a key is added, people pay by bank transfer and you confirm it in <Link href="/admin/payments">Payments</Link>.</span>}
        </p>
        <form action={paystackAction} className="stack" autoComplete="off">
          <div className="grid-2">
            <Field label="Secret key" hint="Starts sk_live_ or sk_test_. Leave empty to keep the saved one."><input name="secret" type="password" autoComplete="off" spellCheck={false} placeholder={c.paystack.secretTail || "sk_live_…"} /></Field>
            <Field label="Public key" hint="Starts pk_live_ or pk_test_."><input name="public" autoComplete="off" spellCheck={false} defaultValue={c.paystack.public} /></Field>
          </div>
          <p className="small muted">In Paystack (Settings, API Keys &amp; Webhooks), set the webhook address to <code className="break">{origin}/api/webhooks/paystack</code> so payments are confirmed even if the payer closes the page.</p>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button className="btn primary" type="submit" data-confirm="Save these Paystack keys?" data-confirm-body="Online payments will use them straight away. With live keys, real money moves." data-confirm-ok="Save keys" data-confirm-tone="default">Save keys</button>
            {c.paystack.source === "settings" ? <button className="btn" name="clear" value="1" type="submit" data-confirm="Remove the saved Paystack keys?" data-confirm-body="Online payments stop until keys are added again. Bank transfers still work." data-confirm-ok="Remove keys">Remove saved keys</button> : null}
          </div>
        </form>
        <p className="small"><Link href="/admin/payments">Bank transfer details shown to payers</Link> are set on the Payments page.</p>
      </section>

      <section className="card stack">
        <h2>Online payments (Stripe)</h2>
        <p>
          {c.stripe.source === "none" ? <span className="pill warn">Not connected</span> : <span className={`pill ${c.stripe.mode === "live" ? "ok" : "warn"}`}>{c.stripe.mode === "live" ? "Live" : "Test mode: no real money moves"}</span>}{" "}
          {c.stripe.source === "server" ? <span className="small muted">Using the key set on the server, which takes priority over anything saved here.</span> : c.stripe.source === "settings" ? <span className="small muted">Secret key saved here, ending {c.stripe.secretTail}.</span> : <span className="small muted">For businesses outside Paystack&apos;s countries (the US, UK, Canada, Europe, Australia, the UAE). Until it is connected, they take bank transfers.</span>}
          {c.stripe.source !== "none" && !c.stripe.webhookSet ? <span className="small" style={{ display: "block", color: "var(--warn, #b45309)" }}>Add the webhook signing secret: without it Stripe payments are not switched on.</span> : null}
        </p>
        <form action={stripeAction} className="stack" autoComplete="off">
          <div className="grid-2">
            <Field label="Secret key" hint="Starts sk_live_ or sk_test_. Leave empty to keep the saved one."><input name="secret" type="password" autoComplete="off" spellCheck={false} placeholder={c.stripe.secretTail || "sk_live_…"} /></Field>
            <Field label="Publishable key" hint="Starts pk_live_ or pk_test_."><input name="public" autoComplete="off" spellCheck={false} defaultValue={c.stripe.public} /></Field>
          </div>
          <Field label="Webhook signing secret" hint={c.stripe.webhookSet ? "Saved. Leave empty to keep it." : "Starts whsec_."}><input name="webhook" type="password" autoComplete="off" spellCheck={false} placeholder={c.stripe.webhookSet ? "••••••••" : "whsec_…"} /></Field>
          <p className="small muted">In Stripe (Developers, Webhooks), add the endpoint <code className="break">{origin}/api/webhooks/stripe</code> with the events payment_intent.succeeded, payment_intent.payment_failed and refund.updated, and paste its signing secret here. Turn on Connect (Express accounts) so businesses can be paid out.</p>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button className="btn primary" type="submit" data-confirm="Save these Stripe keys?" data-confirm-body="Online payments in Stripe's countries use them straight away. With live keys, real money moves." data-confirm-ok="Save keys" data-confirm-tone="default">Save keys</button>
            {c.stripe.source === "settings" ? <button className="btn" name="clear" value="1" type="submit" data-confirm="Remove the saved Stripe keys?" data-confirm-body="Online payments in Stripe's countries stop until keys are added again. Bank transfers still work." data-confirm-ok="Remove keys">Remove saved keys</button> : null}
          </div>
        </form>
      </section>

      <section className="card stack" aria-labelledby="routes-h">
        <h2 id="routes-h">Payment method by country</h2>
        <p className="small muted">Which online provider takes payments in each country Housy works in: plans, and clients paying businesses there. Bank transfer is always available. A provider that does not work in a country cannot be chosen for it.</p>
        <details className="vp-fold">
          <summary>Countries ({COUNTRY_CODES.length})</summary>
          <form action={routesAction} className="stack">
            <div className="fields">
              {COUNTRY_CODES.map((code) => (
                <Field key={code} label={`${COUNTRIES[code].name} (${COUNTRIES[code].currency})`}>
                  <select name={`route_${code}`} defaultValue={c.routes[code]}>
                    {providerCanServe("PAYSTACK", code) ? <option value="PAYSTACK">Paystack{c.paystack.source === "none" ? " (not connected)" : ""}</option> : null}
                    {providerCanServe("STRIPE", code) ? <option value="STRIPE">Stripe{c.stripe.source === "none" ? " (not connected)" : ""}</option> : null}
                    <option value="NONE">Bank transfer only</option>
                  </select>
                </Field>
              ))}
            </div>
            <div className="row"><button className="btn" type="submit" data-confirm="Save the payment method for each country?" data-confirm-body="Payments started from now on use these choices." data-confirm-ok="Save" data-confirm-tone="default">Save countries</button></div>
          </form>
        </details>
      </section>

      <section className="card stack" aria-labelledby="wm-h">
        <h2 id="wm-h">Watermark on property photos</h2>
        <p>{c.watermark.housy ? <span className="pill ok">On for new properties</span> : <span className="pill warn">Off for new properties</span>} <span className="small muted">Already posted: {wm.on} with Housy&apos;s mark, {wm.off} without.</span></p>
        <p className="small muted">Housy&apos;s mark is laid over the public photos of each property posted while it is on; companies&apos; own copies stay clean. Businesses paying for their own logo watermark never get Housy&apos;s mark: they show their logo or keep photos clean.</p>
        <div className="stack" style={{ gap: 8 }}>
          {(c.watermark.housy ? ["off"] : ["on"]).map((to) => (
            <div key={to} className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              <form action={watermarkSwitchAction}><input type="hidden" name="housy" value={to === "on" ? "1" : "0"} /><input type="hidden" name="scope" value="all" />
                <button className="btn" type="submit" data-confirm={`Turn Housy's mark ${to} for all properties?`} data-confirm-body={to === "on" ? "It goes on the photos of every property already posted, and of every property posted from now on (except businesses paying for their own logo watermark)." : "It comes off the photos of every property already posted, and is not put on new ones."} data-confirm-ok={`Turn ${to} for all`} data-confirm-tone="default">Turn {to} for all properties</button>
              </form>
              <form action={watermarkSwitchAction}><input type="hidden" name="housy" value={to === "on" ? "1" : "0"} /><input type="hidden" name="scope" value="new" />
                <button className="btn" type="submit" data-confirm={`Turn Housy's mark ${to} for new properties only?`} data-confirm-body={to === "on" ? "Properties already posted keep their photos as they are; properties posted from now on get the mark." : "Properties already posted keep the mark; properties posted from now on are left without it."} data-confirm-ok={`Turn ${to} for new only`} data-confirm-tone="default">Turn {to} for new properties only</button>
              </form>
            </div>
          ))}
          {c.watermark.housy && wm.off > 0 ? (
            <form action={watermarkSwitchAction}><input type="hidden" name="housy" value="1" /><input type="hidden" name="scope" value="all" />
              <button className="btn" type="submit" data-confirm="Put Housy's mark on all posted properties?" data-confirm-body={`The ${wm.off} posted properties without it get it too.`} data-confirm-ok="Put it on all" data-confirm-tone="default">Also put it on the {wm.off} posted without it</button>
            </form>
          ) : null}
          {!c.watermark.housy && wm.on > 0 ? (
            <form action={watermarkSwitchAction}><input type="hidden" name="housy" value="0" /><input type="hidden" name="scope" value="all" />
              <button className="btn" type="submit" data-confirm="Take Housy's mark off all posted properties?" data-confirm-body={`The ${wm.on} posted properties that still have it lose it too.`} data-confirm-ok="Take it off all" data-confirm-tone="default">Also take it off the {wm.on} posted with it</button>
            </form>
          ) : null}
        </div>
        <form action={watermarkPositionAction} className="stack">
          <fieldset className="choice-row"><legend className="small muted">Where the mark sits</legend>
            <label className="chip-choice"><input type="radio" name="position" value="corner" defaultChecked={c.watermark.position === "corner"} /><span>Bottom corner (small)</span></label>
            <label className="chip-choice"><input type="radio" name="position" value="centre" defaultChecked={c.watermark.position === "centre"} /><span>Across the middle (faint)</span></label>
          </fieldset>
          <div className="row"><button className="btn" type="submit" data-confirm="Move Housy's mark?" data-confirm-body="Every photo that carries it shows it in the new place within a minute or two." data-confirm-ok="Save" data-confirm-tone="default">Save position</button></div>
        </form>
      </section>

      <section className="card stack" aria-labelledby="chat-h">
        <h2 id="chat-h">Live chat</h2>
        <p>{c.liveChat.provider === "none" ? <span className="pill warn">Off</span> : <span className="pill ok">On: {LIVE_CHAT_LABELS[c.liveChat.provider]}</span>} <span className="small muted">Visitors and members chat with your support team from a Chat button. The chat starts only for people who accept optional cookies, and never shows on administration pages.</span></p>
        <form action={liveChatAction} className="stack" autoComplete="off">
          <div className="grid-2">
            <Field label="Provider"><select name="provider" defaultValue={c.liveChat.provider}>{LIVE_CHAT_PROVIDERS.map((p) => <option key={p} value={p}>{LIVE_CHAT_LABELS[p]}</option>)}</select></Field>
            <Field label="Widget ID" hint="From your account with the provider (see below)."><input name="id" spellCheck={false} defaultValue={c.liveChat.id} /></Field>
          </div>
          <details className="vp-fold"><summary>Where to find the widget ID</summary>
            <ul className="small muted">{(Object.keys(LIVE_CHAT_ID_HINTS) as (keyof typeof LIVE_CHAT_ID_HINTS)[]).map((k) => <li key={k}>{LIVE_CHAT_ID_HINTS[k]}</li>)}</ul>
          </details>
          <fieldset className="stack" style={{ gap: 6 }}><legend className="small muted">Show the chat on</legend>
            {LIVE_CHAT_PLACES.map((p) => <label key={p} className="check"><input type="checkbox" name="places" value={p} defaultChecked={c.liveChat.places.includes(p)} /><span>{LIVE_CHAT_PLACE_LABELS[p]}</span></label>)}
          </fieldset>
          <div className="row"><button className="btn primary" type="submit" data-confirm="Save the live chat?" data-confirm-body="The Chat button appears or changes on the pages you chose straight away." data-confirm-ok="Save" data-confirm-tone="default">Save live chat</button></div>
        </form>
      </section>

      <section className="card stack">
        <h2>Check that visitors are people</h2>
        <p className="small muted">Stops automated sign-ups and password guessing. Get keys from <a href="https://www.google.com/recaptcha/admin" target="_blank" rel="noopener">Google reCAPTCHA</a> or <a href="https://dash.cloudflare.com/?to=/:account/turnstile" target="_blank" rel="noopener">Cloudflare Turnstile</a>, adding this site&apos;s address ({new URL(origin).hostname}) as an allowed domain.</p>
        <form action={captchaAction} className="stack" autoComplete="off">
          <Field label="Provider">
            <select name="provider" defaultValue={c.captcha.provider}>
              <option value="none">Off</option>
              <option value="turnstile">Cloudflare Turnstile (no puzzles, privacy-friendly)</option>
              <option value="recaptcha_v2">Google reCAPTCHA v2 (&quot;I&apos;m not a robot&quot; box)</option>
              <option value="recaptcha_v3">Google reCAPTCHA v3 (invisible, scored)</option>
            </select>
          </Field>
          <div className="grid-2">
            <Field label="Site key" hint="The public key."><input name="siteKey" autoComplete="off" spellCheck={false} defaultValue={c.captcha.siteKey} /></Field>
            <Field label="Secret key" hint={c.captcha.secretTail ? `Saved, ending ${c.captcha.secretTail}. Leave empty to keep it.` : "The private key."}><input name="secret" type="password" autoComplete="off" spellCheck={false} /></Field>
          </div>
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small">Ask for it when</legend>
            {CAPTCHA_PLACES.map((p) => <label key={p} className="check"><input type="checkbox" name="places" value={p} defaultChecked={c.captcha.places.includes(p)} /> {CAPTCHA_PLACE_LABELS[p]}</label>)}
          </fieldset>
          <div className="row"><button className="btn primary" type="submit">Save</button></div>
        </form>
      </section>

      <section className="card stack">
        <h2>Cloudflare</h2>
        <form action={cloudflareAction} className="stack">
          <label className="check"><input type="checkbox" name="trust" defaultChecked={c.trustCloudflare} disabled={c.trustCloudflareFromServer} /> Housy is served through Cloudflare</label>
          <p className="small muted">{c.trustCloudflareFromServer ? "Turned on by the server (TRUST_CLOUDFLARE=1)." : "Turn this on only when your domain's traffic goes through Cloudflare (orange cloud). Housy then reads each visitor's real address from Cloudflare, so limits on sign-in attempts and messages apply to the right person. Left on without Cloudflare, visitors could fake their address."}</p>
          {c.trustCloudflareFromServer ? null : <div className="row"><button className="btn" type="submit">Save</button></div>}
        </form>
      </section>

      <section className="card stack">
        <h2>Housy&apos;s commission</h2>
        <p className="small muted">A percentage of each payment made through Housy. Paid online, Paystack sends Housy&apos;s share to Housy and the rest to the company or agent automatically. Paid by direct transfer and recorded by the company, Housy invoices its share each month. A change applies to payments made after it.</p>
        <form action={commissionAction} className="stack">
          <div className="grid-3">
            {COMMISSION_KINDS.map((k) => <Field key={k} label={`${COMMISSION_LABELS[k]} (%)`}><input name={k} inputMode="decimal" defaultValue={c.commission[k]} /></Field>)}
          </div>
          <div className="row"><button className="btn primary" type="submit" data-confirm="Change Housy's commission?" data-confirm-body="Companies and agents see the new rates. They apply to payments made from now on." data-confirm-ok="Save commission" data-confirm-tone="default">Save commission</button></div>
        </form>
      </section>
    </div>
  );
}
