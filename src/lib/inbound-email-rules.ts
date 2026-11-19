// Incoming email: reading what the email provider sends, kept free of the database so it can be tested on its own.
// The provider posts each received email as JSON in Postmark's inbound format (Postmark, and others that can send the same
// shape): From, FromName, To, Cc, OriginalRecipient, Subject, TextBody, HtmlBody, MessageID, Date, Headers, Attachments.

export type InboundAttachment = { name: string; type: string; bytes: Uint8Array };
export type Inbound = {
  fromEmail: string; fromName: string; recipients: string[]; subject: string; text: string; messageId: string;
  autoReply: boolean; attachments: InboundAttachment[];
};

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function addressesIn(v: unknown): string[] {
  if (typeof v !== "string") return [];
  return [...new Set((v.match(EMAIL) ?? []).map((e) => e.toLowerCase()))];
}

/** The company token from an address like in+abc123@in.example.com, when it is on our inbound domain. */
export function tokenFrom(address: string, domain: string): string | null {
  const m = /^[^@+]+\+([a-z0-9]{8,40})@(.+)$/i.exec(address.trim());
  return m && m[2].toLowerCase() === domain.toLowerCase() ? m[1].toLowerCase() : null;
}

/** Plain text from an HTML email, for when there is no text part: no tags, no scripts or styles, entities decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The email as Housy keeps it. Anything unreadable becomes empty rather than failing the whole email. */
export function parseInbound(body: unknown): Inbound {
  const b = (body ?? {}) as Record<string, unknown>;
  const fromFull = b.FromFull as { Email?: string; Name?: string } | undefined;
  const fromEmail = (fromFull?.Email ?? addressesIn(b.From)[0] ?? "").toLowerCase();
  const recipients = [...new Set([...addressesIn(b.To), ...addressesIn(b.Cc), ...addressesIn(b.OriginalRecipient), ...addressesIn(b.Bcc)])];
  const headers = Array.isArray(b.Headers) ? (b.Headers as { Name?: string; Value?: string }[]) : [];
  const header = (n: string) => headers.find((h) => h.Name?.toLowerCase() === n.toLowerCase())?.Value ?? "";
  const auto = header("Auto-Submitted");
  const text = typeof b.TextBody === "string" && b.TextBody.trim() ? b.TextBody : typeof b.HtmlBody === "string" ? htmlToText(b.HtmlBody) : "";
  const attachments: InboundAttachment[] = [];
  for (const a of Array.isArray(b.Attachments) ? (b.Attachments as { Name?: string; ContentType?: string; Content?: string }[]) : []) {
    if (!a?.Content || typeof a.Content !== "string") continue;
    try { attachments.push({ name: String(a.Name ?? "attachment").slice(0, 200), type: String(a.ContentType ?? "").split(";")[0].trim().toLowerCase(), bytes: new Uint8Array(Buffer.from(a.Content, "base64")) }); } catch { /* skip */ }
  }
  return {
    fromEmail, fromName: String(fromFull?.Name ?? b.FromName ?? "").trim().slice(0, 200), recipients,
    subject: String(b.Subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 300),
    text: text.replace(/\r\n?/g, "\n").trim(),
    messageId: String(b.MessageID ?? header("Message-ID") ?? "").trim().slice(0, 300),
    autoReply: (!!auto && auto.toLowerCase() !== "no") || /^(auto(matic)? ?reply|out of (the )?office)/i.test(String(b.Subject ?? "")),
    attachments,
  };
}
