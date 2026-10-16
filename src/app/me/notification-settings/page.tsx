import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getPrefs } from "@/lib/services/delivery";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { savePrefsAction } from "./actions";

export const metadata = { title: "Notification settings" };
export const dynamic = "force-dynamic";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const label = (h: number) => `${String(h).padStart(2, "0")}:00`;

export default async function NotificationSettingsPage({ searchParams }: { searchParams?: SP }) {
  const user = await requireUser();
  const p = await getPrefs(user.id);
  return (
    <div className="stack-lg" style={{ maxWidth: 640 }}>
      <div className="stack" style={{ gap: 6 }}><h1>Notification settings</h1><p className="muted">Everything also appears in your <Link href="/me/notifications">notifications</Link> inside the app. These choices are about email. Messages about the security of your account always reach you.</p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <form action={savePrefsAction} className="card stack">
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend><strong>What to email me</strong></legend>
          <label className="row" style={{ gap: 8, alignItems: "flex-start" }}><input type="checkbox" name="emailActivity" defaultChecked={p.emailActivity} /><span>Activity on my account: messages, reviews, collaborations, rewards, reels.</span></label>
          <label className="row" style={{ gap: 8, alignItems: "flex-start" }}><input type="checkbox" name="emailAlerts" defaultChecked={p.emailAlerts} /><span>Property alerts: new matches for my saved searches and changes to properties I am watching.</span></label>
          <label className="row" style={{ gap: 8, alignItems: "flex-start" }}><input type="checkbox" name="emailPromotional" defaultChecked={p.emailPromotional} /><span>Offers and promotions from the platform. Off unless you turn it on.</span></label>
        </fieldset>
        <Field label="How often" hint="A daily digest puts everything optional into one email. Even with instant emails, if more than five arrive in a day the rest wait for a digest.">
          <select name="digest" defaultValue={p.digest}><option value="INSTANT">As things happen</option><option value="DAILY">One digest a day</option></select>
        </Field>
        <div className="grid">
          <Field label="Quiet hours start" hint="Lagos time. Optional emails wait until quiet hours end."><select name="quietStart" defaultValue={p.quietStart == null ? "" : String(p.quietStart)}><option value="">None</option>{HOURS.map((h) => <option key={h} value={h}>{label(h)}</option>)}</select></Field>
          <Field label="Quiet hours end"><select name="quietEnd" defaultValue={p.quietEnd == null ? "" : String(p.quietEnd)}><option value="">None</option>{HOURS.map((h) => <option key={h} value={h}>{label(h)}</option>)}</select></Field>
        </div>
        <Field label="Areas I care about" hint="Up to 10 cities or areas, separated by commas. We use them to tell you about new properties and new agents there. Leave empty for none."><input name="areas" defaultValue={p.areas.join(", ")} maxLength={300} /></Field>
        <button className="btn primary" type="submit">Save settings</button>
      </form>
    </div>
  );
}
