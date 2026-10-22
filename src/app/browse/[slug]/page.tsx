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
  return <Browse searchParams={await searchParams} category={c} basePath={`/browse/${c.slug}`} />;
}
