/**
 * Small, pure security helpers used across the app so each rule is written once and tested once.
 */

/**
 * A same-site path that is safe to redirect to, or the fallback. Rejects absolute URLs, protocol-relative
 * paths ("//host"), backslash tricks ("/\host", which browsers read as "//host") and control characters.
 */
export function safeLocalPath(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  if (!v.startsWith("/") || v.startsWith("//") || v.length > 500) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(v)) return fallback;
  try {
    const u = new URL(v, "https://site.invalid");
    if (u.origin !== "https://site.invalid") return fallback;
  } catch { return fallback; }
  return v;
}

/** A file name that is safe inside a Content-Disposition header: no quotes, slashes, control characters or non-ASCII. */
export function headerSafeFilename(name: string, fallback = "download"): string {
  const cleaned = name.replace(/[^\w.\- ]+/g, "_").replace(/^\.+/, "").trim().slice(0, 120);
  return cleaned || fallback;
}

