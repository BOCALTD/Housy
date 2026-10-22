import { getSession } from "@/lib/auth";
import { exportMyData } from "@/lib/services/privacy";
import { messageFor } from "@/lib/forms";

export const dynamic = "force-dynamic";

// The signed-in person's own data as a JSON file.
export async function GET() {
  const session = await getSession();
  if (!session) return new Response("Sign in first", { status: 401 });
  try {
    const data = await exportMyData(session.user.id);
    const body = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
    return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="my-data-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    return new Response(messageFor(e), { status: 429 });
  }
}
