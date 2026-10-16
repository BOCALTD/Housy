/**
 * The connection to an AI service. Only the Anthropic API is supported. With no key configured there is no provider, and every
 * feature uses its built-in rules instead, so nothing in the platform depends on this being available.
 */

export interface AiRequest { system: string; user: string; maxTokens: number; signal?: AbortSignal }
export type AiReply = { ok: true; text: string } | { ok: false; error: string };
export interface AiProvider { name: string; complete(req: AiRequest): Promise<AiReply> }

export function anthropicProvider(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): AiProvider {
  return {
    name: "anthropic",
    async complete(req) {
      try {
        const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model, max_tokens: Math.min(2000, Math.max(50, req.maxTokens)), system: req.system, messages: [{ role: "user", content: req.user }] }),
          signal: req.signal,
        });
        if (!res.ok) return { ok: false, error: `The AI service answered ${res.status}` };
        const j = (await res.json()) as { content?: { type?: string; text?: string }[] };
        const text = (j.content ?? []).filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text).join("\n").trim();
        return text ? { ok: true, text } : { ok: false, error: "The AI service sent an empty answer" };
      } catch (e) {
        return { ok: false, error: e instanceof Error && e.name === "AbortError" ? "The AI service took too long" : "The AI service could not be reached" };
      }
    },
  };
}

export function configuredAi(env: Record<string, string | undefined> = process.env): AiProvider | null {
  const key = env.ANTHROPIC_API_KEY?.trim();
  return key ? anthropicProvider(key, env.AI_MODEL?.trim() || "claude-sonnet-4-5") : null;
}

/** The first JSON object in a reply, or null. Models sometimes wrap it in words or code fences. */
export function jsonFrom(text: string): unknown {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}
