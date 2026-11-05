import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { myFlatmateProfile } from "@/lib/services/flatmates";
import { AGE_BANDS, FACTORS, GENDER_PREFS, GENDERS, INTENTS, MUST_KEYS, MUST_MAX, publicName } from "@/lib/flatmate-rules";
import { COUNTRY_GROUPS, visitorCountry } from "@/lib/countries";
import { AMENITIES, FURNISHING, SPACES } from "@/lib/flatmate-rules";
import { ID_TYPES, myFlatmateCheck } from "@/lib/services/flatmates";
import { IdCheckForm } from "@/components/IdCheckForm";
import { submitCheckAction } from "../actions";
import { toDateOnlyString } from "@/lib/dates";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { saveProfileAction } from "../actions";

export const metadata = { title: "My flatmate profile" };
export const dynamic = "force-dynamic";

const naira = (k: bigint | undefined) => (k === undefined ? "" : (k / 100n).toString());
const MUST_LABEL: Record<string, string> = { budget: "Budget", moveIn: "Move-in date", inclusive: "Sharing with LGBTQ+ people", smoking: "Smoking", schedule: "Sleep hours (early riser or late nighter)", personality: "Introvert or extrovert", cleanliness: "Tidiness", guests: "Guests", noise: "Noise", drinking: "Drinking", pets: "Pets" };

export default async function FlatmateProfilePage({ searchParams }: { searchParams?: Promise<SP> }) {
  const s = await searchParams;
  const user = await requireUser();
  const [p, check] = await Promise.all([myFlatmateProfile(user.id), myFlatmateCheck(user.id)]);
  const a = (p?.answers ?? {}) as Record<string, string>;
  const must = new Set((p?.mustMatch ?? "").split(",").filter(Boolean));
  const country = p?.country ?? visitorCountry(await headers());
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">Flatmates</p>
        <h1>{p ? "Edit my flatmate profile" : "Make my flatmate profile"}</h1>
        <p className="muted">Only people who have a flatmate profile in the same city see it, and they see your first name, not your contact details. <Link href="/flatmates">How matching works</Link></p>
      </div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      <form action={saveProfileAction} className="stack-lg">
        <section className="card stack">
          <h2>About you</h2>
          <div className="fields">
            <Field label="Name to show" hint="A first name is enough."><input name="displayName" required minLength={2} maxLength={40} defaultValue={p?.displayName ?? publicName(user.name)} /></Field>
            <Field label="What are you looking for?"><select name="intent" required defaultValue={p?.intent ?? "NEED_ROOM"}>{Object.entries(INTENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Age"><select name="ageBand" required defaultValue={p?.ageBand ?? "25-34"}>{Object.entries(AGE_BANDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Flatmate's age"><select name="agePref" defaultValue={p?.agePref ?? "ANY"}><option value="ANY">Any age</option><option value="SIMILAR">Close to my age</option></select></Field>
            <Field label="Occupation (optional)" hint="For example: student, nurse, software developer."><input name="occupation" maxLength={80} defaultValue={p?.occupation ?? ""} /></Field>
          </div>
          <Field label="A few words about you (optional)" hint="No phone numbers, emails or links: share those in the chat room after you match."><textarea name="about" rows={4} maxLength={800} defaultValue={p?.about ?? ""} /></Field>
        </section>

        <section className="card stack">
          <h2>Where, when and how much</h2>
          <div className="fields">
            <Field label="Country"><select name="country" defaultValue={country}>
              <optgroup label="Popular">{COUNTRY_GROUPS.popular.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</optgroup>
              <optgroup label="All countries">{COUNTRY_GROUPS.all.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</optgroup>
            </select></Field>
            <Field label="City"><input name="city" required maxLength={80} defaultValue={p?.city ?? ""} placeholder="For example Lagos" /></Field>
            <Field label="Areas you like (optional)" hint="Separate with commas."><input name="areas" maxLength={300} defaultValue={p?.areas ?? ""} placeholder="Yaba, Surulere" /></Field>
            <Field label="Lowest monthly budget" hint="In the local currency."><input name="budgetMin" inputMode="numeric" defaultValue={naira(p?.budgetMinKobo)} placeholder="0" /></Field>
            <Field label="Highest monthly budget"><input name="budgetMax" required inputMode="numeric" defaultValue={naira(p?.budgetMaxKobo)} placeholder="150000" /></Field>
            <Field label="Can move in from"><input name="moveInFrom" type="date" required defaultValue={p ? toDateOnlyString(p.moveInFrom) : ""} /></Field>
            <Field label="For how many months? (optional)"><input name="stayMonths" inputMode="numeric" defaultValue={p?.stayMonths ?? ""} /></Field>
            <Field label="Your room's listing (optional)" hint="If you have a room listed here, its reference, for example PROP-ABC123."><input name="roomListingRef" maxLength={40} defaultValue={p?.roomListingRef ?? ""} /></Field>
          </div>
        </section>

        <section className="card stack">
          <h2>The space</h2>
          <p className="small muted">Not only a room: say every kind of place you would share or offer. Tick &ldquo;must match&rdquo; if it really matters.</p>
          <fieldset className="choice-row">
            <legend className="small muted">{p?.intent === "HAVE_ROOM" ? "What I am offering" : "What I would take"}</legend>
            {Object.entries(SPACES).map(([k, v]) => <label key={k} className="chip-choice"><input type="checkbox" name="spaces" value={k} defaultChecked={p?.spaces.includes(k)} /><span>{v}</span></label>)}
          </fieldset>
          <Field label="If something else, what?" hint="For example: boys' quarters, a room in a family house."><input name="spaceOther" maxLength={60} defaultValue={p?.spaceOther ?? ""} /></Field>
          <fieldset className="choice-row">
            <legend className="small muted">Furnishing</legend>
            {Object.entries(FURNISHING).map(([k, v]) => <label key={k} className="chip-choice"><input type="radio" name="furnishing" value={k} defaultChecked={(p?.furnishing ?? "ANY") === k} /><span>{v}</span></label>)}
          </fieldset>
          <fieldset className="choice-row">
            <legend className="small muted">Must-haves</legend>
            {Object.entries(AMENITIES).map(([k, v]) => <label key={k} className="chip-choice"><input type="checkbox" name="amenities" value={k} defaultChecked={p?.amenities.includes(k)} /><span>{v}</span></label>)}
          </fieldset>
          <label className="check fm-must"><input type="checkbox" name="must" value="space" defaultChecked={must.has("space")} /><span>The kind of space must match</span></label>
        </section>

        <section className="card stack">
          <h2>Who you&apos;d share with</h2>
          <div className="fields">
            <Field label="I am"><select name="gender" defaultValue={p?.gender ?? "UNSAID"}>{Object.entries(GENDERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="I'd share with"><select name="genderPref" defaultValue={p?.genderPref ?? "ANY"}>{Object.entries(GENDER_PREFS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          </div>
          <label className="check"><input type="checkbox" name="showGender" defaultChecked={p?.showGender ?? false} /><span>Show my gender on my profile (otherwise it is used only for matching)</span></label>
          <label className="check"><input type="checkbox" name="verifiedOnly" defaultChecked={p?.verifiedOnly ?? false} /><span>Only match me with people who passed the flatmate ID check (you need to pass it too)</span></label>
        </section>

        <section className="card stack">
          <h2>How you live</h2>
          <p className="small muted">Honest answers give better matches. Tick &ldquo;must match&rdquo; on up to {MUST_MAX} that really matter to you: a clash on one of those always shows as Poorly matched.</p>
          <div className="fm-questions">
            {FACTORS.map((f) => (
              <fieldset key={f.key} className="fm-q">
                <legend>{f.question}{f.shown ? "" : <span className="small muted"> (private: used for matching, never shown)</span>}</legend>
                <div className="fm-opts">
                  {f.options.map((o) => (
                    <label key={o.code} className="fm-opt"><input type="radio" name={`a_${f.key}`} value={o.code} required defaultChecked={a[f.key] === o.code} /><span>{o.label}</span></label>
                  ))}
                </div>
                {MUST_KEYS.includes(f.key) ? <label className="check fm-must"><input type="checkbox" name="must" value={f.key} defaultChecked={must.has(f.key)} /><span>Must match</span></label> : null}
              </fieldset>
            ))}
          </div>
          <div className="row">
            {["budget", "moveIn"].map((k) => <label key={k} className="check fm-must"><input type="checkbox" name="must" value={k} defaultChecked={must.has(k)} /><span>{MUST_LABEL[k]} must match</span></label>)}
          </div>
        </section>

        <section className="card stack">
          <label className="check"><input type="checkbox" name="adult" required defaultChecked={!!p} /><span>I am 18 or over, and the information here is about me.</span></label>
          <div className="row"><button className="btn primary" type="submit">{p ? "Save and see matches" : "Create profile and see matches"}</button></div>
        </section>
      </form>

      <section className="card stack" id="verify">
        <div className="row between">
          <div className="stack" style={{ gap: 4 }}><h2>Flatmate ID check</h2><p className="muted small">Verified people get a badge, show up for people who only want verified flatmates, and are trusted faster.</p></div>
          {check?.status === "VERIFIED" ? <span className="pill ok">✓ Verified</span> : check?.status === "PENDING" ? <span className="pill warn">Being checked</span> : check?.status === "REJECTED" ? <span className="pill bad">Needs another look</span> : <span className="pill">Not verified</span>}
        </div>
        {check?.status === "VERIFIED" ? <p className="muted">You are verified. Thank you for helping keep flatmates safe.</p>
          : check?.status === "PENDING" ? <p className="muted">We have your ID and selfie, sent {formatDate(check.submittedAt)}. A reviewer usually answers within a day.</p>
          : (
            <>
              {check?.status === "REJECTED" && check.note ? <p className="flash error" role="note">{check.note}</p> : null}
              <IdCheckForm types={ID_TYPES} action={submitCheckAction} />
            </>
          )}
      </section>
    </div>
  );
}
