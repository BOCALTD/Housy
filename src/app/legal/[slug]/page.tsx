import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { legalDoc, legalDocs, LEGAL_UPDATED } from "@/lib/legal";
import { parseBody } from "@/lib/blog-rules";
import { RichBlocks } from "@/components/RichText";
import { ChangeCookieChoice } from "@/components/CookieNotice";

export function generateStaticParams() { return legalDocs().map((d) => ({ slug: d.slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const d = legalDoc((await params).slug);
  return d ? { title: d.title, description: d.summary, alternates: { canonical: `/legal/${d.slug}` } } : { title: "Not found" };
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const d = legalDoc((await params).slug);
  if (!d) notFound();
  const blocks = parseBody(d.body);
  const toc = blocks.flatMap((b) => (b.t === "h2" ? [{ id: b.id, text: b.text }] : []));
  return (
    <article className="blog-post legal">
      <header className="blog-post-head">
        <nav className="small"><Link href="/legal">Legal</Link> › {d.title}</nav>
        <h1>{d.title}</h1>
        <p className="blog-lede">{d.summary}</p>
        <p className="small muted">Last updated {LEGAL_UPDATED}</p>
      </header>
      <div className="blog-layout">
        {toc.length > 2 ? <aside className="blog-toc" aria-label="On this page"><details open><summary>On this page</summary><ol>{toc.map((h) => <li key={h.id}><a href={`#${h.id}`}>{h.text}</a></li>)}</ol></details></aside> : null}
        <div className="blog-body"><RichBlocks blocks={blocks} />{d.slug === "cookies" ? <p><ChangeCookieChoice /></p> : null}</div>
      </div>
      <nav className="blog-tags" aria-label="Other policies">{legalDocs().filter((x) => x.slug !== d.slug).map((x) => <Link key={x.slug} href={`/legal/${x.slug}`}>{x.title}</Link>)}</nav>
    </article>
  );
}
