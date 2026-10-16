import { requireUser } from "@/lib/auth";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { PLATFORM_NAME } from "@/lib/labels";
import { submitRatingAction } from "./actions";

export const metadata = { title: "Rate the platform" };
export const dynamic = "force-dynamic";

function Stars({ name, label, required }: { name: string; label: string; required?: boolean }) {
  return (
    <fieldset className="stars">
      <legend className="small">{label}</legend>
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n}><input type="radio" name={name} value={n} required={required} aria-label={`${n} out of 5`} /><span aria-hidden="true">{n}</span></label>
      ))}
      <span className="small muted" style={{ flexBasis: "100%" }}>1 is poor, 5 is excellent.</span>
    </fieldset>
  );
}

export default async function FeedbackPage({ searchParams }: { searchParams?: SP }) {
  await requireUser();
  return (
    <div className="stack-lg" style={{ maxWidth: 640 }}>
      <div className="stack" style={{ gap: 6 }}><h1>How is {PLATFORM_NAME} serving you?</h1>
        <p className="muted">It takes a minute. Your answers go to the platform team, who read them and use them to decide what to improve.</p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <form action={submitRatingAction} className="card stack">
        <Stars name="overall" label="Overall, how would you rate your experience?" required />
        <details className="inline"><summary>Rate a few parts (optional)</summary>
          <div className="stack">
            <Stars name="ease" label="Ease of use" />
            <Stars name="trust" label="Trust in what you see" />
            <Stars name="support" label="Help when you needed it" />
          </div>
        </details>
        <Field label="What would make it serve you better?" hint="Optional."><textarea name="suggestion" rows={4} maxLength={2000} /></Field>
        <label className="check"><input type="checkbox" name="anonymous" /> <span>Do not show my name to the team with this answer</span></label>
        <button className="btn primary" type="submit">Send my rating</button>
      </form>
    </div>
  );
}
