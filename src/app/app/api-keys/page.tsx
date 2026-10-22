import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { listApiKeys } from "@/lib/services/api-keys";
import { API_RATE_KEY_PER_MINUTE, SCOPE_LABEL, keyUsable, parseScopes, type ApiScope } from "@/lib/api-rules";
import { formatDateTime, formatDate } from "@/lib/dates";
import { Flash, Pill, TableMore, sp, type SP } from "@/components/ui";
import { NewKeyForm } from "./NewKeyForm";
import { revokeApiKeyAction } from "./actions";

export const metadata = { title: "API keys" };
export const dynamic = "force-dynamic";

export default async function ApiKeysPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("api.manage");
  const keys = await listApiKeys(member);
  const scopes = (Object.keys(SCOPE_LABEL) as ApiScope[]).map((id) => ({ id, label: SCOPE_LABEL[id] }));
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>API keys</h1>
        <p className="muted">Let your other systems read this company&apos;s records. Each key is read-only, limited to what you tick, expires, and can be revoked at any time. Keys are stored only as a fingerprint, so nobody here can see one again after it is made.</p>
        <p className="small"><Link href="/api/v1/openapi">API description (OpenAPI)</Link> · Up to {API_RATE_KEY_PER_MINUTE} requests a minute per key.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card stack" aria-labelledby="new-key"><h2 id="new-key">Make a key</h2><NewKeyForm scopes={scopes} /></section>
      <section className="card stack" aria-labelledby="keys"><h2 id="keys">Keys</h2>
        {keys.length === 0 ? <p className="muted">No keys yet.</p> : (
          <TableMore head={<tr><th>Name</th><th>Starts with</th><th>May</th><th>Status</th><th>Last used</th><th /></tr>} noun="more keys" rows={keys.map((k) => {
            const state = keyUsable(k);
            return (
              <tr key={k.id}>
                <td>{k.name}</td><td><code>hsy_{k.prefix}_…</code></td>
                <td className="small">{parseScopes(k.scopes).join(", ")}</td>
                <td><Pill status={state === "ok" ? "ACTIVE" : "SUSPENDED"} label={state === "ok" ? `Active until ${k.expiresAt ? formatDate(k.expiresAt) : "revoked"}` : state === "revoked" ? "Revoked" : "Expired"} /></td>
                <td className="small">{k.lastUsedAt ? formatDateTime(k.lastUsedAt) : "Never"}</td>
                <td>{state === "ok" ? <form action={revokeApiKeyAction}><input type="hidden" name="id" value={k.id} /><button className="btn small danger" type="submit">Revoke</button></form> : null}</td>
              </tr>
            );
          })} />
        )}
      </section>
    </div>
  );
}
