import { startSafetyAction } from "@/app/me/inspections/actions";

/** Turn on a safety session: how long, who to tell, and explicit consent to share location while it is on. */
export function SafetyStartForm({ bookingRef, consentText, back }: { bookingRef: string; consentText: string; back: string }) {
  return (
    <details className="inline">
      <summary>Turn on a safety session</summary>
      <form action={startSafetyAction} className="stack">
        <input type="hidden" name="ref" value={bookingRef} />
        <input type="hidden" name="back" value={back} />
        <label className="field">How long should it take?<select name="expectedMinutes" defaultValue="60"><option value="30">30 minutes</option><option value="60">1 hour</option><option value="90">1½ hours</option><option value="120">2 hours</option><option value="180">3 hours</option></select></label>
        <fieldset className="field"><legend>Trusted contact (optional)</legend>
          <label className="field">Name<input name="trustedName" maxLength={120} /></label>
          <label className="field">Phone<input name="trustedPhone" maxLength={30} inputMode="tel" /></label>
          <label className="field">Email<input name="trustedEmail" type="email" maxLength={160} /></label>
          <small>You get a private link to send them. They can see your status and last location only while the session is on.</small>
        </fieldset>
        <p className="small">{consentText}</p>
        <label className="check"><input type="checkbox" name="consent" value="yes" required /> I agree to share my location during this session.</label>
        <button className="btn primary" type="submit">Start safety session</button>
      </form>
    </details>
  );
}
