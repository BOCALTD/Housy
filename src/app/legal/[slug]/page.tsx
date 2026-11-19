import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { legalHistory, legalIndex, legalPage } from "@/lib/services/legal-pages";
import { parseBody } from "@/lib/blog-rules";
import { RichBlocks } from "@/components/RichText";
import { ChangeCookieChoice } from "@/components/CookieNotice";
import { formatDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams?: Promise<{ version?: string }> };
const versionOf = (v?: string) => (v && /^\d{1,4}$/.test(v) ? Number(v) : undefined);

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const v = versionOf((await searchParams)?.version);
  const d = await legalPage(slug, v);
  return d ? { title: v ? `${d.title} (version ${v})` : d.title, description: d.summary, alternates: { canonical: `/legal/${slug}` }, robots: v ? { index: false } : undefined } : { title: "Not found" };
}

export default async function LegalPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const asked = versionOf((await searchParams)?.version);
  const [d, history, all] = await Promise.all([legalPage(slug, asked), legalHistory(slug), legalIndex()]);
  if (!d || (!d.body && !asked)) notFound();
  const blocks = parseBody(d.body);
  const toc = blocks.flatMap((b) => (b.t === "h2" ? [{ id: b.id, text: b.text }] : []));
  return (
    <article className="blog-post legal">
      <header className="blog-post-head">
        <nav className="small"><Link href="/legal">Legal</Link> › {d.title}</nav>
        <h1>{d.title}</h1>
        {d.summary ? <p className="blog-lede">{d.summary}</p> : null}
        <p className="small muted">{d.version ? `Version ${d.version}, in effect from ${d.updated}` : `Last updated ${d.updated}`}</p>
        {asked && d.status === "RETIRED" ? <p className="flash warning" role="note">This is an earlier version, kept for reference. <Link href={`/legal/${slug}`}>Read the version in effect</Link>.</p> : null}
        {!asked && d.upcoming ? <p className="flash notice" role="note">A new version takes effect on {d.upcoming.effectiveFrom}. <Link href={`/legal/${slug}?version=${d.upcoming.version}`}>Read it now</Link>.</p> : null}
        {d.changeNote ? <p className="small"><strong>What changed:</strong> {d.changeNote}</p> : null}
      </header>
      <div className="blog-layout">
        {toc.length > 2 ? <aside className="blog-toc" aria-label="On this page"><details open><summary>On this page</summary><ol>{toc.map((h) => <li key={h.id}><a href={`#${h.id}`}>{h.text}</a></li>)}</ol></details></aside> : null}
        <div className="blog-body"><RichBlocks blocks={blocks} />{slug === "cookies" ? <p><ChangeCookieChoice /></p> : null}</div>
      </div>
      {history.length > 1 || (history.length === 1 && asked) ? (
        <details className="vp-fold legal-history">
          <summary>Earlier versions ({history.length})</summary>
          <ul className="small">{history.map((h) => (
            <li key={h.version}><Link href={h.version === d.version && !asked ? `/legal/${slug}` : `/legal/${slug}?version=${h.version}`}>Version {h.version}</Link>, published {formatDate(h.publishedAt!)}{h.effectiveFrom ? `, in effect from ${formatDate(h.effectiveFrom)}` : ""}{h.changeNote ? `: ${h.changeNote}` : ""}</li>
          ))}</ul>
        </details>
      ) : null}
      <nav className="blog-tags" aria-label="Other policies">{all.filter((x) => x.slug !== slug).map((x) => <Link key={x.slug} href={`/legal/${x.slug}`}>{x.title}</Link>)}</nav>
    </article>
  );
}
