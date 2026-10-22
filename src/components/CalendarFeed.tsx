"use client";

import { useActionState, useState } from "react";
import { makeFeedAction, removeFeedAction, type FeedState } from "@/app/calendar-actions";

/** Turn on a private calendar feed of the person's inspections, shown once, with how to add it to common calendar apps. */
export function CalendarFeed({ since }: { since: string | null }) {
  const [made, make, making] = useActionState<FeedState, FormData>(makeFeedAction, {});
  const [gone, remove, removing] = useActionState<FeedState, FormData>(removeFeedAction, {});
  const [copied, setCopied] = useState(false);
  const active = !gone.removed && (!!made.https || !!since);
  if (made.https && !gone.removed) {
    return (
      <div className="stack" role="status">
        <p><strong>Your calendar link is ready.</strong> Anyone with this link can see your inspection times, so keep it private. It is shown only now; make a new one if you lose it.</p>
        <code className="secret-box">{made.https}</code>
        <div className="row">
          <a className="btn primary" href={made.webcal}>Add to Apple or Outlook calendar</a>
          <button className="btn" type="button" onClick={() => { void navigator.clipboard?.writeText(made.https!).then(() => setCopied(true)); }}>{copied ? "Copied" : "Copy link"}</button>
        </div>
        <details className="inline"><summary>Google Calendar</summary>
          <p className="small">On a computer, open Google Calendar, choose <strong>Other calendars → + → From URL</strong>, paste the link and press <strong>Add calendar</strong>. Google refreshes it every few hours.</p>
        </details>
      </div>
    );
  }
  return (
    <div className="stack">
      {made.error || gone.error ? <p className="flash error" role="alert">{made.error ?? gone.error}</p> : null}
      <p className="small muted">{active ? `Your calendar link has been on since ${since}. Making a new one stops the old one working.` : "Your phone or computer calendar can show your inspections and update itself when a time changes or an inspection is cancelled."}</p>
      <div className="row">
        <form action={make}><button className="btn primary" type="submit" disabled={making}>{active ? "Make a new link" : "Turn on calendar link"}</button></form>
        {active ? <form action={remove}><button className="btn" type="submit" disabled={removing}>Turn off</button></form> : null}
      </div>
    </div>
  );
}
