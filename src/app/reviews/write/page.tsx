import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { inviteInfo, reviewableConversations } from "@/lib/services/reviews";
import { BASIS_LABEL } from "@/lib/reputation-rules";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { RatingFields } from "@/components/Reputation";
import { submitReviewAction } from "../actions";

export const metadata = { title: "Write a review" };
export const dynamic = "force-dynamic";

export default async function WriteReviewPage({ searchParams }: { searchParams?: SP }) {
  const user = await requireUser();
  const invite = sp(searchParams, "invite");
  const conversation = sp(searchParams, "conversation");
  let heading = "", problem: string | null = null;
  if (invite) {
    const i = await inviteInfo(invite);
    if (!i.ok) problem = i.problem; else heading = `${BASIS_LABEL[i.basis]} with ${i.agent ? `${i.agent} at ` : ""}${i.company}`;
  } else if (conversation) {
    const c = (await reviewableConversations(user.id)).find((x) => x.id === conversation);
    if (!c) problem = "You can review an agent after you have both written in a conversation and a day has passed."; else heading = `${BASIS_LABEL.ENQUIRY} with ${c.agentName}`;
  } else problem = "Open a review link from the company, or choose a conversation from your reviews page.";
  return (
    <div className="stack-lg" style={{ maxWidth: 640 }}>
      <div className="stack" style={{ gap: 6 }}><h1>Write a review</h1>{heading ? <p className="muted">{heading}. Reviews are tied to a real interaction and are shown with your first name and initial only.</p> : null}</div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {problem ? <div className="card stack"><p>{problem}</p><Link href="/me/reviews">Go to my reviews</Link></div> : (
        <form action={submitReviewAction} className="card stack">
          {invite ? <input type="hidden" name="invite" value={invite} /> : <input type="hidden" name="conversation" value={conversation} />}
          <RatingFields />
          <Field label="Tell others what it was like" hint="Optional. Stick to what happened. Reviews with wording copied from elsewhere are checked by a person."><textarea name="body" rows={5} maxLength={2000} /></Field>
          <button className="btn primary" type="submit">Publish my review</button>
        </form>
      )}
    </div>
  );
}
