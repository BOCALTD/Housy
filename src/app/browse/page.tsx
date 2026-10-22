import { Browse } from "@/components/Browse";
import type { SP } from "@/components/ui";

export const metadata = { title: "Search properties" };
export const dynamic = "force-dynamic";

export default async function BrowsePage({ searchParams }: { searchParams?: Promise<SP> }) {
  return <Browse searchParams={await searchParams} category={null} basePath="/browse" />;
}
