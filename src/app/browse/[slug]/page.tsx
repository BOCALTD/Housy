import Link from "next/link";
import { notFound } from "next/navigation";
import { Browse } from "@/components/Browse";
import { categoryBySlug } from "@/lib/listing-rules";
import type { SP } from "@/components/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const c = categoryBySlug((await params).slug);
  return { title: c ? c.title : "Not found", description: c?.intro };
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<SP> }) {
  const c = categoryBySlug((await params).slug);
  if (!c) notFound();
  const browse = <Browse searchParams={await searchParams} category={c} basePath={`/browse/${c.slug}`} />;
  if (c.slug !== "rooms") return browse;
  // Rooms and shared homes: point people to flatmate matching as well as the listings.
  return (
    <div className="stack-lg">
      <aside className="card row between" aria-label="Flatmate matching">
        <span><strong>Looking for someone to share with?</strong> <span className="muted">Get matched with flatmates by how you live, from 0% to 100%.</span></span>
        <Link className="btn primary" href="/flatmates">Find a flatmate</Link>
      </aside>
      {browse}
    </div>
  );
}
