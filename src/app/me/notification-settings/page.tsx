import { zoneLabel } from "@/lib/dates";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getPrefs } from "@/lib/services/delivery";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { savePrefsAction } from "./actions";
import { myDevices, pushPublicKey } from "@/lib/services/push";
import { PushSettings } from "@/components/PushSettings";
import { removeDeviceFormAction } from "@/app/push-actions";
import { formatDate } from "@/lib/dates";
import { smsConfig } from "@/lib/services/sms";

export const metadata = { title: "Notification settings" };
export const dynamic = "force-dynamic";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const label = (h: number) => `${String(h).padStart(2, "0")}:00`;

export default async function NotificationSettingsPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const user = await requireUser();
  const p = await getPrefs(user.id);
  const devices = await myDevices(user.id);
  const smsOn = (await smsConfig()).provider !== "none";
  return (
    <div className="stack-lg" style={{ maxWidth: 640 }}>
      <div className="stack" style={{ gap: 6 }}><h1>Notification settings</h1><p className="muted">Everything also appears in your <Link href="/me/notifications">notifications</Link> inside the app. The first choices are about email and text messages; push notifications to your devices are below. Messages about the security of your account always reach you.</p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <form action={savePrefsAction} className="card stack">
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend><strong>What to email me</strong></legend>
          <label className="row" style={{ gap: 8, alignItems: "flex-start" }}><input type="checkbox" name="emailActivity" defaultChecked={p.emailActivity} /><span>Activity on my account: messages, reviews, collaborations, rewards, reels.</span></label>
          <label className="row" style={{ gap: 8, alignItems: "flex-start" }}><input type="checkbox" name="emailAlerts" defaultChecked={p.emailAlerts} /><span>Property alerts: new matches for my saved searches and changes to properties I am watching.</span></label>
          <label className="row" style={{ gap: 8, alignItems: "flex-start" }}><input type="checkbox" name="emailPromotional" defaultChecked={p.emailPromotional} /><span>Offers and promotions from the platform. Off unless you turn it on.</span></label>
        </fieldset>
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend><strong>Text messages</strong></legend>
          <label className="row" style={{ gap: 8, alignItems: "flex-start" }}><input type="checkbox" name="smsImportant" defaultChecked={p.smsImportant} /><span>Text me important notices: account security alerts (such as a password change), inspection confirmations and reminders, and failed payments. Off unless you turn it on.</span></label>
          <Field label="Mobile number" hint={smsOn ? "With the country code, such as +234 803 123 4567. Used only for these texts and by companies you deal with." : "Texts are not switched on for this platform yet. Your choice is kept for when they are."}><input name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={24} defaultValue={p.phone} /></Field>
        </fieldset>
        <Field label="How often" hint="A daily digest puts everything optional into one email. Even with instant emails, if more than five arrive in a day the rest wait for a digest.">
          <select name="digest" defaultValue={p.digest}><option value="INSTANT">As things happen</option><option value="DAILY">One digest a day</option></select>
        </Field>
        <div className="grid">
          <Field label="Quiet hours start" hint={`In your time zone (${zoneLabel()}). Optional emails wait until quiet hours end.`}><select name="quietStart" defaultValue={p.quietStart == null ? "" : String(p.quietStart)}><option value="">None</option>{HOURS.map((h) => <option key={h} value={h}>{label(h)}</option>)}</select></Field>
          <Field label="Quiet hours end"><select name="quietEnd" defaultValue={p.quietEnd == null ? "" : String(p.quietEnd)}><option value="">None</option>{HOURS.map((h) => <option key={h} value={h}>{label(h)}</option>)}</select></Field>
        </div>
        <Field label="Areas I care about" hint="Up to 10 cities or areas, separated by commas. We use them to tell you about new properties and new agents there. Leave empty for none."><input name="areas" defaultValue={p.areas.join(", ")} maxLength={300} /></Field>
        <button className="btn primary" type="submit">Save settings</button>
      </form>
      <section className="card stack" id="push">
        <h2>On your phone or computer</h2>
        <p className="small muted">Get a pop-up when an inspection is confirmed, a message arrives, an invoice is paid and so on, even when the app is closed. Security notices and account activity are sent; offers and promotions never are. You choose this for each device.</p>
        <PushSettings publicKey={pushPublicKey()} />
        {devices.length ? (
          <details className="inline"><summary>Devices receiving notifications ({devices.length})</summary>
            <ul className="card-list">
              {devices.map((d) => (
                <li key={d.id} className="row between">
                  <span>{d.label || "Device"}<span className="small muted"> · added {formatDate(d.createdAt)}{d.lastSuccessAt ? ` · last delivered ${formatDate(d.lastSuccessAt)}` : ""}</span></span>
                  <form action={removeDeviceFormAction}><input type="hidden" name="id" value={d.id} /><button className="btn" type="submit" data-confirm="Remove this device?" data-confirm-body="It stops getting notifications from Housy." data-confirm-ok="Remove">Remove</button></form>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
    </div>
  );
}
