import Link from "next/link";
import { legalIndex } from "@/lib/services/legal-pages";

export const metadata = { title: "Legal", description: "Terms of use, privacy policy, cookie notice, community guidelines and how to delete your account.", alternates: { canonical: "/legal" } };
export const dynamic = "force-dynamic";

export default async function LegalIndex() {
  const docs = await legalIndex();
  return (
    <div className="stack-lg legal">
      <section className="cf-hero"><div><p className="eyebrow">Legal and policies</p><h1>Clear rules, plainly written</h1><p className="muted">How Housy works, how your data is looked after, and your rights. Each page shows its version and the date it took effect.</p></div><div className="cf-hero-art" aria-hidden="true"><span /><span /><span /></div></section>
      <ul className="cf-grid">{docs.map((d, i) => (
        <li key={d.slug} style={{ ["--i" as string]: i }}><Link href={`/legal/${d.slug}`} className="cf-client legal-card"><span className="cf-folder" aria-hidden="true"><b>§</b></span><span className="cf-client-text"><strong>{d.title}</strong><span className="small muted">{d.summary}</span></span></Link></li>
      ))}</ul>
    </div>
  );
}
