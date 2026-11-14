import Link from "next/link";
import { headers } from "next/headers";
import { requirePlatformAdmin } from "@/lib/auth";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { CAPTCHA_PLACES, CAPTCHA_PLACE_LABELS, COMMISSION_KINDS, COMMISSION_LABELS, configForAdmin } from "@/lib/services/platform-config";
import { captchaAction, cloudflareAction, commissionAction, paystackAction } from "./actions";

export const metadata = { title: "Platform settings" };
export const dynamic = "force-dynamic";

export default async function PlatformSettings({ searchParams: s }: { searchParams?: Promise<SP> }) {
  const searchParams = await s;
  await requirePlatformAdmin();
  const c = await configForAdmin();
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  return (
    <div className="stack-lg settings-page">
      <div className="stack" style={{ gap: 6 }}>
        <Link className="small" href="/admin">Administration</Link>
        <h1>Platform settings</h1>
        <p className="muted">Payments, the check that visitors are people, Cloudflare, and Housy&apos;s commission. Secret keys are stored encrypted and never shown again in full.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

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
