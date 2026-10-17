import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { DEMO_USERS } from "@/lib/demo";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { setupAction } from "./actions";

export const metadata = { title: "Set up", robots: { index: false } };
export const dynamic = "force-dynamic";
// Creating demo data hashes several passwords; allow time for it on serverless hosts.
export const maxDuration = 60;

export default async function SetupPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  if (await prisma.user.count({ where: { isPlatformAdmin: true } })) redirect("/login");
  const configured = (process.env.SETUP_TOKEN ?? "").length >= 16;

  return (
    <div style={{ maxWidth: 560, marginInline: "auto" }} className="stack">
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">First run</p>
        <h1>Create the platform administrator</h1>
        <p className="muted">This page works once. After the first platform administrator exists, it redirects to sign in.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error") }} />
      {!configured ? (
        <div className="card stack">
          <p>Setup is locked. Add a <span className="mono">SETUP_TOKEN</span> environment variable of at least 16 characters in your hosting settings, redeploy, then reload this page.</p>
        </div>
      ) : (
        <form action={setupAction} className="card stack">
          <Field label="Setup token" hint="The SETUP_TOKEN value from your hosting settings.">
            <input name="token" id="token" type="password" required autoComplete="off" />
          </Field>
          <Field label="Your full name"><input name="name" id="name" required autoComplete="name" /></Field>
          <Field label="Email"><input name="email" id="email" type="email" required autoComplete="email" /></Field>
          <Field label="Password" hint="At least 12 characters.">
            <input name="password" id="password" type="password" required minLength={12} autoComplete="new-password" />
          </Field>
          <label className="check">
            <input type="checkbox" name="demo" id="demo" />
            <span>
              Add demonstration data: two companies, assets, a lease and published listings, all labelled [DEMO].
              <span className="small muted" style={{ display: "block" }}>Demo sign-ins: {DEMO_USERS.map((u) => u.email).join(", ")}.</span>
            </span>
          </label>
          <button className="btn primary" type="submit">Create administrator</button>
        </form>
      )}
    </div>
  );
}
