/**
 * Rules for the public API (version 1): what a key may do, what a response looks like, how paging works.
 * Pure functions with no database, so they are tested on their own.
 */
import { createHash } from "node:crypto";

export const API_VERSION = "v1";
export const API_SCOPES = ["assets:read"] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export const SCOPE_LABEL: Record<ApiScope, string> = { "assets:read": "Read this company's assets and their listing status" };

export const API_PAGE_SIZE_DEFAULT = 25;
export const API_PAGE_SIZE_MAX = 100;
export const API_KEY_PREFIX = "hsy";
export const API_RATE_PUBLIC_PER_MINUTE = 60;
export const API_RATE_KEY_PER_MINUTE = 120;
export const API_KEY_MAX_PER_COMPANY = 10;
export const API_KEY_MAX_DAYS = 365;

/** A key looks like hsy_<8 letters, shown in lists>_<secret>. Only the hash of the whole string is stored. */
export function formatApiKey(prefix: string, secret: string) { return `${API_KEY_PREFIX}_${prefix}_${secret}`; }

export function parseApiKey(raw: string | null | undefined): { prefix: string } | null {
  if (!raw) return null;
  const m = /^hsy_([A-Za-z0-9]{8})_([A-Za-z0-9_-]{32,64})$/.exec(raw.trim());
  return m ? { prefix: m[1] } : null;
}

export function hashApiKey(raw: string): string { return createHash("sha256").update(raw.trim()).digest("hex"); }

/** The key is taken from "Authorization: Bearer <key>" only, never from the address, so it does not end up in logs. */
export function bearerFrom(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return m ? m[1] : null;
}

export function parseScopes(stored: string): ApiScope[] { return stored.split(",").filter((s): s is ApiScope => (API_SCOPES as readonly string[]).includes(s)); }
export function hasScope(stored: string, scope: ApiScope) { return parseScopes(stored).includes(scope); }

export function keyUsable(k: { revokedAt: Date | null; expiresAt: Date | null }, now = new Date()): "ok" | "revoked" | "expired" {
  if (k.revokedAt) return "revoked";
  if (k.expiresAt && k.expiresAt.getTime() <= now.getTime()) return "expired";
  return "ok";
}

/** Page numbers start at 1. Anything unreadable falls back to the default rather than failing. */
export function pagingFrom(params: URLSearchParams) {
  const num = (k: string, d: number) => { const n = Number.parseInt(params.get(k) ?? "", 10); return Number.isFinite(n) && n > 0 ? n : d; };
  const page = Math.min(num("page", 1), 10_000);
  const pageSize = Math.min(num("page_size", API_PAGE_SIZE_DEFAULT), API_PAGE_SIZE_MAX);
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export type Envelope<T> = { data: T; meta: { version: string; page?: number; page_size?: number; total?: number; pages?: number }; links?: { self: string; next: string | null; prev: string | null } };

export function pageLinks(path: string, params: URLSearchParams, page: number, pages: number) {
  const make = (p: number) => { const q = new URLSearchParams(params); q.set("page", String(p)); return `${path}?${q.toString()}`; };
  return { self: make(page), next: page < pages ? make(page + 1) : null, prev: page > 1 ? make(page - 1) : null };
}

export function pagedEnvelope<T>(rows: T[], total: number, page: number, pageSize: number, path: string, params: URLSearchParams): Envelope<T[]> {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return { data: rows, meta: { version: API_VERSION, page, page_size: pageSize, total, pages }, links: pageLinks(path, params, page, pages) };
}

export const API_ERRORS = {
  unauthorized: { status: 401, code: "unauthorized", message: "Send your key as 'Authorization: Bearer <key>'. The key is missing, wrong, revoked or expired." },
  forbidden: { status: 403, code: "forbidden", message: "This key does not have permission for that." },
  not_found: { status: 404, code: "not_found", message: "Nothing was found at that address." },
  rate_limited: { status: 429, code: "rate_limited", message: "Too many requests. Wait a minute and try again." },
  server: { status: 500, code: "server_error", message: "Something went wrong on our side." },
} as const;
export type ApiErrorName = keyof typeof API_ERRORS;

/** Money is always sent as whole kobo (an integer string) together with its currency, so nothing is lost to rounding. */
export function money(kobo: bigint | null | undefined) { return kobo == null ? null : { amount_kobo: kobo.toString(), currency: "NGN" }; }
