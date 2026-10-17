import { requireMember } from "@/lib/auth";
import { assetOptions } from "@/lib/services/assets";
import { listTeam } from "@/lib/services/companies";
import { listDepartments } from "@/lib/services/settings";
import { CATEGORIES, PRIORITIES } from "@/lib/services/correspondence";
import { todayInLagos, toDateOnlyString } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { EnumOptions, Field, Flash, sp, type SP } from "@/components/ui";
import { registerAction } from "../actions";

export const metadata = { title: "Register correspondence" };

export default async function NewCorrespondencePage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("correspondence.register");
  const [assets, departments, team] = await Promise.all([
    assetOptions(member), listDepartments(member), listTeam(member),
  ]);
  const canAssign = can(member.role, "correspondence.assign");
  const today = toDateOnlyString(todayInLagos());
  const direction = sp(searchParams, "direction") === "OUTGOING" ? "OUTGOING" : "INCOMING";

  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <h1>Register correspondence</h1>
      <nav className="nav" aria-label="Direction">
        <a href="/app/correspondence/new" aria-current={direction === "INCOMING" ? "page" : undefined}>Incoming letter</a>
        <a href="/app/correspondence/new?direction=OUTGOING" aria-current={direction === "OUTGOING" ? "page" : undefined}>New outgoing letter</a>
      </nav>
      <Flash searchParams={{ error: sp(searchParams, "error") }} />
      <form action={registerAction} className="card stack">
        <input type="hidden" name="direction" value={direction} />
        <Field label="Subject"><input name="subject" id="subject" required /></Field>
        <div className="fields">
          <Field label={direction === "INCOMING" ? "From (sender)" : "From"}>
            <input name="senderName" id="senderName" required defaultValue={direction === "OUTGOING" ? member.companyName : ""} />
          </Field>
          <Field label={direction === "INCOMING" ? "To" : "To (recipient)"}>
            <input name="recipientName" id="recipientName" required defaultValue={direction === "INCOMING" ? member.companyName : ""} />
          </Field>
        </div>
        <div className="fields">
          <Field label="Copied to" hint="Optional."><input name="copiedTo" id="copiedTo" /></Field>
          <Field label="Their reference" hint="The sender's own reference, if any."><input name="externalRef" id="externalRef" /></Field>
        </div>
        <div className="fields">
          <Field label="Category"><select name="category" id="category" defaultValue="General">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Priority"><select name="priority" id="priority" defaultValue="NORMAL"><EnumOptions values={PRIORITIES} /></select></Field>
          <Field label="Department" hint="Its code goes into the reference.">
            <select name="departmentId" id="departmentId" defaultValue="">
              <option value="">None</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
            </select>
          </Field>
        </div>
        <div className="fields">
          {direction === "INCOMING" ? (
            <Field label="Date received"><input name="dateReceived" id="dateReceived" type="date" required defaultValue={today} max={today} /></Field>
          ) : null}
          <Field label={direction === "INCOMING" ? "Reply needed by" : "Send by"} hint="Optional. Drives overdue alerts.">
            <input name="responseDeadline" id="responseDeadline" type="date" />
          </Field>
          <Field label="Related asset" hint="Optional.">
            <select name="assetId" id="assetId" defaultValue="">
              <option value="">None</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.ref} · {a.name}</option>)}
            </select>
          </Field>
        </div>
        {canAssign && direction === "INCOMING" ? (
          <Field label="Assign to" hint="Optional. You can assign later.">
            <select name="assigneeId" id="assigneeId" defaultValue="">
              <option value="">Not yet</option>
              {team.members.filter((m) => m.status === "ACTIVE").map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}
            </select>
          </Field>
        ) : null}
        <Field label={direction === "INCOMING" ? "Summary" : "Purpose"} hint="Optional."><textarea name="description" id="description" rows={3} /></Field>
        {direction === "OUTGOING" ? (
          <Field label="Letter text" hint="Saved as a draft. A manager other than you must approve it before it is sent.">
            <textarea name="draftResponse" id="draftResponse" rows={10} required />
          </Field>
        ) : null}
        <Field label={direction === "INCOMING" ? "Scanned letter" : "Attachment"} hint="Optional. PDF, JPG, PNG, WEBP or Word, up to 4 MB.">
          <input name="file" id="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx" />
        </Field>
        <label className="check">
          <input type="checkbox" name="confidential" id="confidential" />
          <span>Confidential. Only managers, the assigned officer and you can see it.</span>
        </label>
        <div className="row"><button className="btn primary" type="submit">Register</button></div>
      </form>
    </div>
  );
}
