import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { GROUPS, managedForAdmin, runtimeEnv, type AdminField, type Group } from "@/lib/runtime-env";
import { configuredDriver } from "@/lib/email-drivers";
import { vapidFromEnv } from "@/lib/webpush";
import { identityProviders } from "@/lib/identity-providers";
import { configuredAi } from "@/lib/ai-provider";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { makePushKeysAction, saveConnectionsAction, testEmailAction } from "./actions";

export const metadata = { title: "Connections" };
export const dynamic = "force-dynamic";

const ORDER: Group[] = ["email", "contact", "push", "maps", "identity", "ai", "google", "verification", "security"];

function Input({ f }: { f: AdminField }) {
  if (f.server) return <p className="small"><span className="pill">Set on the server</span> <span className="muted">{f.kind === "secret" ? f.tail : f.value || "(set)"}. To change it here, remove it from the server&apos;s settings file first.</span></p>;
  if (f.kind === "bool") return <label className="row" style={{ gap: 8 }}><input type="checkbox" name={f.name} defaultChecked={f.value === "true"} /><span>{f.label}</span></label>;
  if (f.kind === "select") return <select name={f.name} defaultValue={f.value}>{f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
  if (f.kind === "textarea") return <textarea name={f.name} rows={3} maxLength={500} defaultValue={f.value} />;
  if (f.kind === "secret") return (
    <span className="stack" style={{ gap: 4 }}>
      <input name={f.name} type="password" autoComplete="new-password" spellCheck={false} placeholder={f.set ? `Saved (${f.tail}). Leave empty to keep it.` : ""} />
      {f.set ? <label className="row small" style={{ gap: 6 }}><input type="checkbox" name="clear" value={f.name} /> Remove the saved key</label> : null}
    </span>
  );
  return <input name={f.name} type={f.kind === "email" ? "email" : f.kind === "number" ? "number" : "text"} inputMode={f.kind === "number" ? "numeric" : f.kind === "url" ? "url" : undefined} spellCheck={false} defaultValue={f.value} placeholder={f.placeholder} />;
}

export default async function ConnectionsPage({ searchParams: spP }: { searchParams?: Promise<SP> }) {
  const searchParams = await spP;
  await requirePlatformAdmin();
  const [groups, env] = await Promise.all([managedForAdmin(), runtimeEnv()]);
  const mail = configuredDriver(env);
  const state: Record<Group, [string, string]> = {
    email: mail ? [`Connected (${mail.name === "smtp" ? "SMTP" : "Resend"})`, "ok"] : ["Not connected", "warn"],
    contact: env.SUPPORT_EMAIL && env.LEGAL_ENTITY_NAME ? ["Set", "ok"] : ["Incomplete", "warn"],
    push: vapidFromEnv(env) ? ["Keys set", "ok"] : ["No keys", "warn"],
    maps: env.NEXT_PUBLIC_MAP_TILES ? ["Provider set", "ok"] : ["Public tiles (testing only)", "warn"],
    identity: identityProviders(env).length ? [identityProviders(env).map((p) => p.name).join(", "), "ok"] : ["By hand", ""],
    ai: configuredAi(env) ? ["Connected", "ok"] : ["Built-in rules", ""],
    google: env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ? ["Set", "ok"] : ["Off", ""],
    verification: ["", ""],
    security: env.REQUIRE_ADMIN_MFA === "true" ? ["Required", "ok"] : ["Not required", "warn"],
  };
  return (
    <div className="stack-lg" style={{ maxWidth: 960 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1>Connections</h1>
        <p className="muted">Outside services and site details, set here instead of on the server. Keys are stored encrypted and shown only by their last four characters. Changes apply within a minute, with no restart. Payments, text messages, incoming email, video storage and live chat are in <Link href="/admin/settings">Settings</Link>.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {ORDER.map((g) => (
        <details key={g} id={g} className="card vp-fold" open={sp(searchParams, "open") === g}>
          <summary><strong>{GROUPS[g].title}</strong> {state[g][0] ? <span className={`pill ${state[g][1]}`}>{state[g][0]}</span> : null}</summary>
          <div className="stack" style={{ marginTop: 10 }}>
            {GROUPS[g].intro ? <p className="small muted">{GROUPS[g].intro}</p> : null}
            <form action={saveConnectionsAction} className="stack" autoComplete="off">
              <input type="hidden" name="group" value={g} />
              <div className="grid-2">
                {groups[g].map((f) => f.kind === "bool" && !f.server ? <div key={f.name} style={{ gridColumn: "1 / -1" }}><Input f={f} /></div> : (
                  <Field key={f.name} label={f.label} hint={f.hint}><Input f={f} /></Field>
                ))}
              </div>
              <div className="row wrap" style={{ gap: 8 }}>
                <button className="btn primary" type="submit" data-confirm={`Save ${GROUPS[g].title.toLowerCase()}?`} data-confirm-body="The new values are used straight away." data-confirm-ok="Save">Save</button>
              </div>
            </form>
            {g === "email" ? <form action={testEmailAction}><button className="btn" type="submit" disabled={!mail}>Send me a test email</button></form> : null}
            {g === "push" && !groups.push.some((f) => f.server) ? (
              <form action={makePushKeysAction}>
                <button className="btn" type="submit" data-confirm={vapidFromEnv(env) ? "Make new push keys?" : "Make push keys?"} data-confirm-body={vapidFromEnv(env) ? "Every phone and computer that has notifications on must turn them on again." : "Keys are made and saved here; nothing else to do."} data-confirm-ok="Make keys">{vapidFromEnv(env) ? "Make new keys" : "Make keys"}</button>
              </form>
            ) : null}
          </div>
        </details>
      ))}
      <section className="card stack" aria-labelledby="server-h">
        <h2 id="server-h">Kept on the server</h2>
        <p className="small muted">These are needed before the platform can read anything saved here, so they stay in the server&apos;s settings file. The installer sets them; you never need to change them in normal use: the database connection and its passwords, the key that encrypts the secrets saved on this page, the site&apos;s web address, the product name, and the secrets that protect scheduled jobs and unsubscribe links.</p>
      </section>
    </div>
  );
}
