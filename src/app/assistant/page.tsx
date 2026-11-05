import { getSession } from "@/lib/auth";
import { STARTERS } from "@/lib/assistant-knowledge";
import { AssistantChat } from "@/components/AssistantChat";

export const metadata = { title: "Assistant", description: "Ask Housy: find homes in a sentence, and get answers about renting, buying, inspections and staying safe." };
export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  const session = await getSession();
  return (
    <div className="ai-page">
      <AssistantChat name={session?.user.name ?? null} starters={STARTERS.public} />
    </div>
  );
}
