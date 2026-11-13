import { redirect } from "next/navigation";
import { Field, Flash, sp, type SP } from "@/components/ui";

export const metadata = { title: "Check a verification report", description: "Check that a property verification report issued through Housy is genuine, current and not revoked." };

export default async function CheckReport({ searchParams: s }: { searchParams?: Promise<SP> }) {
  const searchParams = await s;
  const q = (sp(searchParams, "ref") ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (/^VR-[A-Z2-9]{10}$/.test(q)) redirect(`/verification/check/${q}`);
  return (
    <div className="wrap stack-lg vp" style={{ maxWidth: 640 }}>
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">Property verification</p>
        <h1>Check a verification report</h1>
        <p className="muted">Every report issued through Housy&apos;s verification network has a reference starting with VR-. Enter it to see who issued the report, which version is current, and whether it has been withdrawn.</p>
      </div>
      <Flash searchParams={{ error: q ? "That does not look like a report reference. It starts with VR- followed by 10 letters and numbers." : undefined }} />
      <form className="card stack" method="get">
        <Field label="Report reference"><input name="ref" required defaultValue={q} placeholder="VR-XXXXXXXXXX" autoCapitalize="characters" spellCheck={false} /></Field>
        <div className="row"><button className="btn primary" type="submit">Check</button></div>
      </form>
    </div>
  );
}
