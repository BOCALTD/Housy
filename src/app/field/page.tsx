import { FieldKit } from "@/components/FieldKit";

export const metadata = { title: "Field kit", description: "Record inspections without a connection and send them when you are back online.", robots: { index: false } };

// The page itself holds nothing personal, so the installed app can keep an anonymous copy and open it offline.
// The inspector's work lives on their device (IndexedDB) and travels through /api/field, which checks the sign-in on every request.
export default function FieldPage() {
  return <FieldKit />;
}
