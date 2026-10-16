import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PROPERTY_TYPES, PURPOSES } from "@/lib/services/vacancies";
import { todayInLagos, toDateOnlyString } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { submitVacancyAction } from "../actions";

export const metadata = { title: "Report a vacancy" };
export const dynamic = "force-dynamic";

export default async function NewVacancyPage({ searchParams }: { searchParams?: SP }) {
  await requireUser();
  const today = toDateOnlyString(todayInLagos());
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Report a vacancy</h1><p className="muted">Only report what you actually saw, recently. <Link href="/vacancies">Back</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <form action={submitVacancyAction} className="card stack" encType="multipart/form-data">
        <Field label="Kind of property"><select name="propertyType" required defaultValue="">{<option value="" disabled>Choose</option>}{PROPERTY_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select></Field>
        <Field label="It looks available to"><select name="purpose" defaultValue="UNKNOWN">{PURPOSES.map((t) => <option key={t} value={t}>{t === "UNKNOWN" ? "I am not sure" : humanize(t)}</option>)}</select></Field>
        <Field label="Bedrooms" hint="Optional."><input name="bedrooms" inputMode="numeric" maxLength={3} /></Field>
        <Field label="Street address or nearest landmark"><input name="address" required minLength={5} maxLength={200} autoComplete="street-address" /></Field>
        <Field label="Neighbourhood"><input name="area" required minLength={2} maxLength={100} /></Field>
        <Field label="City or town"><input name="city" required minLength={2} maxLength={100} /></Field>
        <Field label="State"><input name="state" required minLength={2} maxLength={100} /></Field>
        <details className="inline"><summary>Add the map position (optional)</summary>
          <div className="stack"><Field label="Latitude" hint="For example 6.6018"><input name="latitude" inputMode="decimal" /></Field><Field label="Longitude" hint="For example 3.3515"><input name="longitude" inputMode="decimal" /></Field></div></details>
        <Field label="What did you see?" hint="Condition, signs such as a to-let board, anything that helps someone find it."><textarea name="description" required minLength={20} maxLength={1500} rows={5} /></Field>
        <Field label="When did you see it?"><input type="date" name="observedOn" required max={today} /></Field>
        <Field label="Anything you know about the owner or agent" hint="Optional. Only the review team sees this."><input name="ownerContact" maxLength={200} /></Field>
        <Field label="Photographs" hint="Up to 3, JPG, PNG or WEBP, 4 MB in all. Take them from the street. Do not photograph people."><input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple /></Field>
        <fieldset className="stack"><legend>Your privacy</legend>
          <p className="small muted">Your name is never shown publicly. Nothing below is ticked for you.</p>
          <label className="check"><input type="checkbox" name="allowContact" /><span>The review team may contact me by email or phone if they need to. Without this, we use in-app messages only.</span></label>
          <label className="check"><input type="checkbox" name="showNameToOwner" /><span>The owner may be told my name. Without this, they are told only that a member of the community noticed it.</span></label>
          <label className="check"><input type="checkbox" name="understood" required /><span>I understand my report is reviewed by people, that it is not a listing, and that false or copied reports can lead to rewards being paused.</span></label>
        </fieldset>
        <button className="btn primary" type="submit">Send report</button>
      </form>
    </div>
  );
}
