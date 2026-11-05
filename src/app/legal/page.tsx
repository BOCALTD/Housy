import Link from "next/link";
import { legalDocs, LEGAL_UPDATED } from "@/lib/legal";

export const metadata = { title: "Legal", description: "Terms of use, privacy policy, cookie notice, community guidelines and how to delete your account.", alternates: { canonical: "/legal" } };

export default function LegalIndex() {
  return (
    <div className="stack-lg legal">
      <section className="cf-hero"><div><p className="eyebrow">Legal and policies</p><h1>Clear rules, plainly written</h1><p className="muted">How Housy works, how we look after your data, and your rights. Last updated {LEGAL_UPDATED}.</p></div><div className="cf-hero-art" aria-hidden="true"><span /><span /><span /></div></section>
      <ul className="cf-grid">{legalDocs().map((d, i) => (
        <li key={d.slug} style={{ ["--i" as string]: i }}><Link href={`/legal/${d.slug}`} className="cf-client legal-card"><span className="cf-folder" aria-hidden="true"><b>§</b></span><span className="cf-client-text"><strong>{d.title}</strong><span className="small muted">{d.summary}</span></span></Link></li>
      ))}</ul>
    </div>
  );
}
