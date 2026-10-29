import { NewPassword } from "@/components/PasswordInput";
import Link from "next/link";
import { Flash, sp, type SP } from "@/components/ui";
import { resetLinkIsValid } from "@/lib/services/account";
import { resetAction } from "./actions";

export const metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

export default async function ResetPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const token = sp(searchParams, "t") ?? "";
  const ok = await resetLinkIsValid(token);
  return (
    <div style={{ maxWidth: 440, marginInline: "auto" }} className="stack">
      <h1>Choose a new password</h1>
      <Flash searchParams={{ error: sp(searchParams, "error") }} />
      {ok ? (
        <form action={resetAction} className="card stack">
          <input type="hidden" name="t" value={token} />
          <NewPassword label="New password" />
          <p className="small muted">You will be signed out on every device.</p>
          <button className="btn primary" type="submit">Save the new password</button>
        </form>
      ) : (
        <div className="card stack"><p>This link is not valid any more. Links work once and expire after 1 hour.</p><p><Link className="btn" href="/forgot">Get a new link</Link></p></div>
      )}
    </div>
  );
}
