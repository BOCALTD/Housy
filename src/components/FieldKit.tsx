"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { kvClear, kvDel, kvGet, kvList, kvPut, shrinkPhoto } from "@/lib/field-store";
import { RECORD_FIELDS, RESULT_WORDS, progress, resolveConflicts, type Conflict, type FieldRecord } from "@/lib/field-merge";

// ---------- What is kept on the device ----------

type Item = { id: string; category: string; prompt: string };
type PackInspection = { id: string; ref: string; purpose: string; scheduledFor: string; revision: number; asset: { name: string; address: string }; items: Item[]; record: FieldRecord };
type Pack = { userId: string; userName: string; companyName: string; packedAt: string; inspections: PackInspection[] };
type Finding = { clientId: string; title: string; severity: string; safetyRisk: boolean; location: string; description: string; recommendedAction: string; estimatedCost: string };
type Draft = { base: FieldRecord; record: FieldRecord; findings: Finding[]; photos: string[]; submit: boolean; savedAt: string };
type Photo = { blob: Blob; inspectionId: string; findingClientId: string | null; caption: string; takenAt: string };
type Outbox = {
  clientId: string; inspectionId: string; base: FieldRecord; mine: FieldRecord; findings: Finding[]; photoIds: string[]; submit: boolean;
  state: "waiting" | "conflicts" | "closed" | "error" | "sent"; queuedAt: string;
  sentPhotos?: string[]; findingIds?: Record<string, string>; office?: FieldRecord; conflicts?: Conflict[]; error?: string; note?: string; sentAt?: string;
};

const RATINGS = { EXCELLENT: "Excellent", GOOD: "Good", FAIR: "Fair", POOR: "Poor", CRITICAL: "Critical" } as const;
const SEVERITIES = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" } as const;
const RESULTS = ["PASS", "ATTENTION", "FAIL", "NOT_APPLICABLE"] as const;
const SHORT: Record<string, string> = { PASS: "Pass", ATTENTION: "Attention", FAIL: "Fail", NOT_APPLICABLE: "N/A" };
const PAGE = 8;

const todayLagos = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
const human = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

class Offline extends Error {}
class SignedOut extends Error {}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try { res = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store" }); } catch { throw new Offline("No connection"); }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401) throw new SignedOut(body.error ?? "Sign in again");
  if (!res.ok) throw new Error(body.error ?? "That could not be sent");
  return body;
}

// ---------- The kit ----------

export function FieldKit() {
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [user, setUser] = useState<string | null>(null);
  const [pack, setPack] = useState<Pack | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [outbox, setOutbox] = useState<Record<string, Outbox>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "download" | "sync">("");
  const [shown, setShown] = useState(PAGE);
  const [storageError, setStorageError] = useState("");
  const syncing = useRef(false);

  const load = useCallback(async (uid: string) => {
    const [p, d, o] = await Promise.all([kvGet<Pack>(`pack:${uid}`), kvList<Draft>(`draft:${uid}:`), kvList<Outbox>(`out:${uid}:`)]);
    setPack(p ?? null);
    setDrafts(Object.fromEntries(d.map(([k, v]) => [k.split(":")[2], v])));
    setOutbox(Object.fromEntries(o.map(([k, v]) => [k.split(":")[2], v])));
  }, []);

  /** Download (or refresh) the inspections assigned to the signed-in user. Ones still being worked on here are kept. */
  const download = useCallback(async (quiet = false) => {
    if (!quiet) setBusy("download");
    try {
      const fresh = await call<Pack>("/api/field/pack");
      const old = await kvGet<Pack>(`pack:${fresh.userId}`);
      const working = new Set([...(await kvList(`draft:${fresh.userId}:`)), ...(await kvList(`out:${fresh.userId}:`))].map(([k]) => k.split(":")[2]));
      const kept = (old?.inspections ?? []).filter((i) => working.has(i.id) && !fresh.inspections.some((f) => f.id === i.id));
      const next = { ...fresh, inspections: [...fresh.inspections, ...kept] };
      await kvPut(`pack:${fresh.userId}`, next);
      await kvPut("last-user", fresh.userId);
      setUser(fresh.userId); setSignedOut(false);
      await load(fresh.userId);
      if (!quiet) toast.success(`${fresh.inspections.length} inspection${fresh.inspections.length === 1 ? "" : "s"} ready to use without a connection`);
    } catch (e) {
      if (e instanceof SignedOut) setSignedOut(true);
      else if (!quiet) toast.error(e instanceof Offline ? "You are offline. Download while you have a connection." : (e as Error).message);
    } finally { if (!quiet) setBusy(""); }
  }, [load]);

  /** Send everything waiting, oldest first. Stops at the first sign the connection or the sign-in is gone. */
  const sync = useCallback(async (uid: string, quiet = false) => {
    if (syncing.current) return;
    syncing.current = true;
    if (!quiet) setBusy("sync");
    let sent = 0;
    try {
      const entries = (await kvList<Outbox>(`out:${uid}:`)).map(([, v]) => v).filter((o) => o.state === "waiting").sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
      for (const o of entries) {
        const key = `out:${uid}:${o.inspectionId}`;
        try {
          if (!o.office) {
            const r = await call<{ outcome: string; status?: string; record?: FieldRecord; revision?: number; conflicts?: Conflict[]; findings?: Record<string, string> }>("/api/field/sync", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ clientId: o.clientId, inspectionId: o.inspectionId, base: o.base, mine: o.mine, findings: o.findings }),
            });
            if (r.outcome === "closed") {
              Object.assign(o, { state: "closed", note: `The office has already ${r.status === "CANCELLED" ? "cancelled" : "closed"} this inspection, so it was not changed. Your copy is kept here.` });
              await kvPut(key, o); continue;
            }
            Object.assign(o, { office: r.record, conflicts: r.conflicts ?? [], findingIds: r.findings ?? {} });
            await kvPut(key, o);
            const p = await kvGet<Pack>(`pack:${uid}`);
            if (p && r.record) { p.inspections = p.inspections.map((i) => (i.id === o.inspectionId ? { ...i, record: r.record!, revision: r.revision ?? i.revision } : i)); await kvPut(`pack:${uid}`, p); }
          }
          // Photos go after the record, so photos of a new defect can be attached to it.
          o.sentPhotos ??= [];
          for (const pid of o.photoIds.filter((x) => !o.sentPhotos!.includes(x))) {
            const ph = await kvGet<Photo>(`photo:${uid}:${pid}`);
            if (!ph) { o.sentPhotos.push(pid); continue; }
            const fd = new FormData();
            fd.set("file", new File([ph.blob], `site-${pid.slice(0, 8)}.jpg`, { type: ph.blob.type || "image/jpeg" }));
            fd.set("clientId", pid); fd.set("inspectionId", o.inspectionId); fd.set("caption", ph.caption);
            if (ph.findingClientId && o.findingIds?.[ph.findingClientId]) fd.set("findingId", o.findingIds[ph.findingClientId]);
            await call("/api/field/photo", { method: "POST", body: fd });
            o.sentPhotos.push(pid);
            await kvDel(`photo:${uid}:${pid}`);
            await kvPut(key, o);
          }
          if (o.conflicts?.length) { o.state = "conflicts"; await kvPut(key, o); continue; }
          if (o.submit) {
            try { await call("/api/field/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inspectionId: o.inspectionId }) }); o.note = "Sent and submitted for approval."; }
            catch (e) { if (e instanceof Offline || e instanceof SignedOut) throw e; o.note = `Sent, but not submitted: ${(e as Error).message}`; }
          } else o.note = "Sent. Submit it for approval from the inspection page when it is complete.";
          Object.assign(o, { state: "sent", sentAt: new Date().toISOString() });
          await kvPut(key, o);
          sent += 1;
        } catch (e) {
          if (e instanceof Offline || e instanceof SignedOut) throw e;
          Object.assign(o, { state: "error", error: (e as Error).message });
          await kvPut(key, o);
        }
      }
      if (sent && !quiet) toast.success(`${sent} inspection${sent === 1 ? "" : "s"} sent to the office`);
      else if (sent) toast.success(`Back online: ${sent} inspection${sent === 1 ? "" : "s"} sent`);
    } catch (e) {
      if (e instanceof SignedOut) { setSignedOut(true); toast.error("Sign in again to send. Your work stays on this device."); }
      else if (!quiet) toast.error("Still offline. Your work will be sent when the connection returns.");
    } finally {
      syncing.current = false;
      if (!quiet) setBusy("");
      await load(uid);
    }
  }, [load]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setOnline(navigator.onLine);
      try {
        const last = await kvGet<string>("last-user");
        if (last && alive) { setUser(last); await load(last); }
        if (navigator.onLine) {
          await download(true);
          const now = await kvGet<string>("last-user");
          if (now) await sync(now, true);
        }
      } catch { setStorageError("This browser is not letting the field kit store anything (private browsing, or storage turned off). Open it in a normal window to work offline."); }
      if (alive) setReady(true);
    })();
    const on = () => { setOnline(true); void kvGet<string>("last-user").then((u) => { if (u) void sync(u, true); }); };
    const off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { alive = false; window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [download, load, sync]);

  // Keep a copy of this page on the device so it opens without a connection (an anonymous copy, as for public pages).
  useEffect(() => { if (pack && "caches" in window) void caches.open("housy-v3-pages").then((c) => c.add(new Request("/field", { credentials: "omit" }))).catch(() => {}); }, [pack]);

  async function removeAll() {
    if (!user) return;
    const waiting = Object.values(outbox).filter((o) => o.state !== "sent").length + Object.keys(drafts).length;
    if (waiting && !window.confirm(`${waiting} inspection${waiting === 1 ? " has" : "s have"} work that has not reached the office. Remove it from this device anyway?`)) return;
    for (const p of ["pack:", "draft:", "out:", "photo:"]) await kvClear(`${p}${user}${p === "pack:" ? "" : ":"}`);
    await kvDel("last-user");
    setUser(null); setPack(null); setDrafts({}); setOutbox({}); setOpen(null);
    toast.success("Removed from this device");
  }

  const list = pack?.inspections ?? [];
  const waiting = Object.values(outbox).filter((o) => o.state === "waiting").length;
  const current = list.find((i) => i.id === open) ?? null;

  if (!ready) return <div className="card"><p className="muted">Opening the field kit…</p></div>;

  return (
    <div className="stack-lg fk">
      <section className="card stack">
        <div className="row between">
          <div className="stack" style={{ gap: 4 }}>
            <h1>Field kit</h1>
            <p className="small muted">Record inspections where there is no signal. Your work is kept in this browser on this device until it reaches the office.</p>
          </div>
          <span className={`pill ${online ? "ok" : "warn"}`} role="status">{online ? "Online" : "Offline"}</span>
        </div>
        {storageError ? <p className="small fk-warn">{storageError}</p> : null}
        {signedOut ? <p className="small fk-warn">You are signed out. {online ? <a href="/login?next=/field">Sign in</a> : "Sign in when you are back online"} to download inspections or send your work; nothing here is lost.</p> : null}
        {pack ? <p className="small muted">Downloaded for {pack.userName || "you"}{pack.companyName ? ` at ${pack.companyName}` : ""} · {new Date(pack.packedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" })}</p> : null}
        <div className="row">
          <button type="button" className="btn primary" disabled={!online || busy !== ""} onClick={() => download()}>{busy === "download" ? "Downloading…" : pack ? "Refresh my inspections" : "Download my inspections"}</button>
          {user ? <button type="button" className="btn" disabled={!online || busy !== "" || waiting === 0} onClick={() => sync(user)}>{busy === "sync" ? "Sending…" : `Send now${waiting ? ` (${waiting})` : ""}`}</button> : null}
          {user ? <button type="button" className="btn" onClick={removeAll}>Remove from this device</button> : null}
        </div>
      </section>

      {current && user ? (
        <Editor key={current.id} uid={user} insp={current} draft={drafts[current.id]} out={outbox[current.id]} online={online}
          onClose={() => setOpen(null)} onChange={() => load(user)} onSend={() => { if (online) void sync(user); }} />
      ) : !pack ? (
        <section className="card stack">
          <h2>Before you go out</h2>
          <ol className="fk-steps small">
            <li>While you have a connection, sign in and press <strong>Download my inspections</strong>. The inspections assigned to you for the last 60 days and the next 14 are saved here.</li>
            <li>On site, open an inspection, answer the checklist, note defects and take photos. Everything saves on this device as you go.</li>
            <li>Press <strong>Send to the office</strong>. It goes as soon as there is a connection. If someone in the office changed the same answer meanwhile, you choose which to keep.</li>
          </ol>
          <p className="small muted">Payments, identity checks and anything that needs a live check are not available offline.</p>
        </section>
      ) : list.length === 0 ? (
        <section className="card"><p className="muted">No open inspections are assigned to you. When a manager assigns one, refresh here.</p></section>
      ) : (
        <section className="stack" aria-labelledby="fk-list">
          <h2 id="fk-list">My inspections</h2>
          <ul className="fk-list">
            {list.slice(0, shown).map((i) => {
              const d = drafts[i.id], o = outbox[i.id];
              const pr = progress(d?.record ?? i.record);
              const state = o ? { waiting: "Waiting to send", conflicts: "Needs your decision", closed: "Closed in the office", error: "Not accepted", sent: "Sent" }[o.state] : d ? "In progress on this device" : pr.done ? "Started" : "Not started";
              return (
                <li key={i.id}>
                  <button type="button" className="fk-row" onClick={() => setOpen(i.id)}>
                    <span className="fk-row-main"><strong>{i.asset.name}</strong><span className="small muted">{i.ref} · {human(i.purpose)} · {day(i.scheduledFor)}</span><span className="small muted">{i.asset.address}</span></span>
                    <span className="fk-row-side"><span className={`pill${o?.state === "conflicts" || o?.state === "error" ? " bad" : o?.state === "sent" ? " ok" : o?.state === "waiting" || d ? " warn" : ""}`}>{state}</span><span className="small muted">{pr.done} of {pr.total} checked</span></span>
                  </button>
                </li>
              );
            })}
          </ul>
          {list.length > shown ? <button type="button" className="btn" onClick={() => setShown((n) => n + PAGE)}>Show more ({list.length - shown})</button> : null}
        </section>
      )}
    </div>
  );
}

// ---------- One inspection ----------

function Editor({ uid, insp, draft, out, online, onClose, onChange, onSend }: {
  uid: string; insp: PackInspection; draft?: Draft; out?: Outbox; online: boolean; onClose: () => void; onChange: () => void; onSend: () => void;
}) {
  const fresh = (): Draft => ({ base: insp.record, record: { ...insp.record, conductedOn: insp.record.conductedOn || todayLagos(), responses: { ...insp.record.responses } }, findings: [], photos: [], submit: false, savedAt: "" });
  const [d, setD] = useState<Draft>(draft ?? fresh());
  const [thumbs, setThumbs] = useState<Record<string, { url: string; caption: string; finding: string | null }>>({});
  const [saved, setSaved] = useState(draft?.savedAt ?? "");
  const [photoFor, setPhotoFor] = useState("");
  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState<Record<string, "office" | "mine">>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uidKey = `draft:${uid}:${insp.id}`;
  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of insp.items) { const a = m.get(it.category); if (a) a.push(it); else m.set(it.category, [it]); }
    return [...m];
  }, [insp.items]);

  useEffect(() => {
    let urls: string[] = [];
    void (async () => {
      const t: typeof thumbs = {};
      for (const pid of d.photos) {
        const ph = await kvGet<Photo>(`photo:${uid}:${pid}`);
        if (ph) { const url = URL.createObjectURL(ph.blob); urls.push(url); t[pid] = { url, caption: ph.caption, finding: ph.findingClientId }; }
      }
      setThumbs(t);
    })();
    return () => { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; };
  }, [uid, d.photos]);

  function update(next: Draft) {
    setD(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const at = new Date().toISOString();
      try { await kvPut(uidKey, { ...next, savedAt: at }); setSaved(at); onChange(); }
      catch { toast.error("This device is out of storage. Send what you have, or remove photos."); }
    }, 350);
  }
  const setField = (k: keyof typeof RECORD_FIELDS, v: string) => update({ ...d, record: { ...d.record, [k]: v } });
  const setItem = (id: string, patch: Partial<{ result: string; note: string }>) => update({ ...d, record: { ...d.record, responses: { ...d.record.responses, [id]: { ...d.record.responses[id], ...patch } } } });

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    const ids: string[] = [];
    for (const f of Array.from(files).slice(0, 10)) {
      if (d.photos.length + ids.length >= 30) { toast.error("Up to 30 photos per inspection"); break; }
      try {
        const blob = await shrinkPhoto(f);
        const pid = newId();
        const finding = d.findings.find((x) => x.clientId === photoFor);
        await kvPut(`photo:${uid}:${pid}`, { blob, inspectionId: insp.id, findingClientId: finding?.clientId ?? null, caption: finding ? finding.title : "Photo taken on site", takenAt: new Date().toISOString() } satisfies Photo);
        ids.push(pid);
      } catch (e) { toast.error((e as Error).message || "That photo could not be stored"); }
    }
    if (ids.length) update({ ...d, photos: [...d.photos, ...ids] });
  }
  async function removePhoto(pid: string) {
    await kvDel(`photo:${uid}:${pid}`);
    update({ ...d, photos: d.photos.filter((x) => x !== pid) });
  }

  async function send() {
    const pr = progress(d.record);
    if (d.submit && (pr.done < pr.total || !d.record.conditionRating || !d.record.summary.trim())) {
      toast.error("To submit for approval, answer every checklist item and give an overall condition and a summary. Or untick submit to send what you have.");
      return;
    }
    const o: Outbox = { clientId: newId(), inspectionId: insp.id, base: d.base, mine: d.record, findings: d.findings, photoIds: d.photos, submit: d.submit, state: "waiting", queuedAt: new Date().toISOString() };
    if (timer.current) clearTimeout(timer.current);
    await kvPut(`out:${uid}:${insp.id}`, o);
    await kvDel(uidKey);
    onChange();
    toast.success(online ? "Sending to the office…" : "Saved to send. It goes when you are back online.");
    onSend();
  }

  async function resolve() {
    if (!out?.office || !out.conflicts) return;
    if (out.conflicts.some((c) => !choice[c.key])) { toast.error("Choose which to keep for each item"); return; }
    const mine = resolveConflicts(out.office, out.mine, out.conflicts.filter((c) => choice[c.key] === "mine").map((c) => c.key));
    const next: Outbox = { clientId: newId(), inspectionId: insp.id, base: out.office, mine, findings: [], photoIds: [], submit: out.submit, state: "waiting", queuedAt: new Date().toISOString() };
    await kvPut(`out:${uid}:${insp.id}`, next);
    onChange(); onSend();
  }

  async function editAgain() {
    if (!out) return;
    const base = out.office ?? out.base;
    await kvPut(uidKey, { base, record: out.mine, findings: out.office ? [] : out.findings, photos: out.photoIds.filter((p) => !(out.sentPhotos ?? []).includes(p)), submit: false, savedAt: new Date().toISOString() } satisfies Draft);
    await kvDel(`out:${uid}:${insp.id}`);
    onChange(); onClose();
  }
  async function forget() { if (out) { await kvDel(`out:${uid}:${insp.id}`); onChange(); onClose(); } }

  const pr = progress(d.record);
  const head = (
    <div className="row between">
      <div className="stack" style={{ gap: 2 }}>
        <h2>{insp.asset.name}</h2>
        <span className="small muted">{insp.ref} · {human(insp.purpose)} · due {day(insp.scheduledFor)}</span>
        {insp.asset.address ? <span className="small muted">{insp.asset.address}</span> : null}
      </div>
      <button type="button" className="btn" onClick={onClose}>Back to the list</button>
    </div>
  );

  if (out && (out.state === "waiting" || out.state === "conflicts" || out.state === "closed")) {
    return (
      <section className="card stack">
        {head}
        {out.state === "waiting" ? <p className="fk-note">Waiting to send{online ? "…" : ". It goes when you are back online."} Saved {time(out.queuedAt)}.</p> : null}
        {out.state === "closed" ? <><p className="fk-note">{out.note}</p><div className="row"><button type="button" className="btn" onClick={forget}>Remove my copy</button></div></> : null}
        {out.state === "conflicts" ? (
          <div className="stack">
            <p className="fk-note">Everything else was sent. Someone in the office changed {out.conflicts!.length === 1 ? "one answer" : `${out.conflicts!.length} answers`} differently while you were away. Choose which to keep.</p>
            {out.conflicts!.map((c) => (
              <fieldset key={c.key} className="fk-conflict">
                <legend>{c.label}</legend>
                <label className="fk-choice"><input type="radio" name={`c-${c.key}`} checked={choice[c.key] === "office"} onChange={() => setChoice({ ...choice, [c.key]: "office" })} /><span><strong>Keep the office&apos;s</strong><span className="small">{c.office || "(blank)"}</span></span></label>
                <label className="fk-choice"><input type="radio" name={`c-${c.key}`} checked={choice[c.key] === "mine"} onChange={() => setChoice({ ...choice, [c.key]: "mine" })} /><span><strong>Use mine</strong><span className="small">{c.mine || "(blank)"}</span></span></label>
              </fieldset>
            ))}
            <div className="row"><button type="button" className="btn primary" onClick={resolve} disabled={!online}>Send my choices</button>{!online ? <span className="small muted">Needs a connection</span> : null}</div>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="card stack" aria-label={`Inspection ${insp.ref}`}>
      {head}
      {out?.state === "sent" ? <p className="fk-note">{out.note} {out.sentAt ? `(${time(out.sentAt)})` : ""} You can record more and send again.</p> : null}
      {out?.state === "error" ? <><p className="fk-note fk-warn">The office did not accept this: {out.error}</p><div className="row"><button type="button" className="btn" onClick={editAgain}>Correct it and send again</button><button type="button" className="btn" onClick={forget}>Discard it</button></div></> : null}

      <div className="fk-grid">
        <label className="field"><span>Date inspected</span><input type="date" max={todayLagos()} value={d.record.conductedOn} onChange={(e) => setField("conductedOn", e.target.value)} /></label>
        <label className="field"><span>Overall condition</span>
          <select value={d.record.conditionRating} onChange={(e) => setField("conditionRating", e.target.value)}>
            <option value="">Choose…</option>
            {Object.entries(RATINGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>

      <div className="stack" role="group" aria-label="Checklist">
        <div className="row between"><h3>Checklist</h3><span className="small muted">{pr.done} of {pr.total} checked{pr.failed ? ` · ${pr.failed} failed` : ""}</span></div>
        {groups.map(([cat, items], gi) => {
          const done = items.filter((it) => d.record.responses[it.id]?.result !== "PENDING").length;
          return (
            <details key={cat} className="fk-group" open={gi === 0}>
              <summary><span>{cat}</span><span className="small muted">{done}/{items.length}</span></summary>
              <ul className="fk-items">{items.map((it) => <CheckItem key={it.id} item={it} value={d.record.responses[it.id] ?? { result: "PENDING", note: "" }} onChange={(p) => setItem(it.id, p)} />)}</ul>
            </details>
          );
        })}
      </div>

      <label className="field"><span>Summary</span><textarea rows={3} maxLength={5000} value={d.record.summary} onChange={(e) => setField("summary", e.target.value)} placeholder="The overall state of the property in a few sentences" /></label>
      <label className="field"><span>Recommended actions</span><textarea rows={2} maxLength={5000} value={d.record.recommendedActions} onChange={(e) => setField("recommendedActions", e.target.value)} /></label>
      <details className="inline">
        <summary>More details</summary>
        <div className="stack">
          <label className="field"><span>Where on site</span><input maxLength={300} value={d.record.location} onChange={(e) => setField("location", e.target.value)} /></label>
          <label className="field"><span>Who was present</span><input maxLength={500} value={d.record.participants} onChange={(e) => setField("participants", e.target.value)} /></label>
          <label className="field"><span>Technical notes</span><textarea rows={2} maxLength={3000} value={d.record.technicalNotes} onChange={(e) => setField("technicalNotes", e.target.value)} /></label>
        </div>
      </details>

      <div className="stack">
        <div className="row between"><h3>Defects</h3>{!adding ? <button type="button" className="btn" onClick={() => setAdding(true)}>Add a defect</button> : null}</div>
        {d.findings.length ? <ul className="fk-findings">{d.findings.map((f) => (
          <li key={f.clientId}><span><strong>{f.title}</strong> <span className="small muted">{SEVERITIES[f.severity as keyof typeof SEVERITIES]}{f.safetyRisk ? " · safety risk" : ""}{f.location ? ` · ${f.location}` : ""}</span></span>
            <button type="button" className="btn small" onClick={() => update({ ...d, findings: d.findings.filter((x) => x.clientId !== f.clientId) })}>Remove</button></li>
        ))}</ul> : !adding ? <p className="small muted">None noted.</p> : null}
        {adding ? <FindingForm onCancel={() => setAdding(false)} onAdd={(f) => { update({ ...d, findings: [...d.findings, f] }); setAdding(false); }} /> : null}
      </div>

      <div className="stack">
        <h3>Photos</h3>
        {d.findings.length ? (
          <label className="field"><span>Photos of</span>
            <select value={photoFor} onChange={(e) => setPhotoFor(e.target.value)}>
              <option value="">The inspection in general</option>
              {d.findings.map((f) => <option key={f.clientId} value={f.clientId}>Defect: {f.title}</option>)}
            </select>
          </label>
        ) : null}
        <label className="btn fk-camera">Take or add photos<input type="file" accept="image/*" capture="environment" multiple onChange={(e) => { void addPhotos(e.target.files); e.target.value = ""; }} /></label>
        {d.photos.length ? <ul className="fk-thumbs">{d.photos.map((pid) => thumbs[pid] ? (
          <li key={pid}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbs[pid].url} alt={thumbs[pid].caption} />
            <button type="button" className="btn small" onClick={() => removePhoto(pid)} aria-label={`Remove photo: ${thumbs[pid].caption}`}>Remove</button>
          </li>
        ) : null)}</ul> : <p className="small muted">Photos are made smaller and kept on this device until sent.</p>}
      </div>

      <label className="fk-check"><input type="checkbox" checked={d.submit} onChange={(e) => update({ ...d, submit: e.target.checked })} /><span>Submit for approval once it is sent (every item answered, with a condition and a summary)</span></label>
      <div className="row between">
        <span className="small muted" role="status">{saved ? `Saved on this device · ${time(saved)}` : "Changes save on this device as you go"}</span>
        <button type="button" className="btn primary" onClick={send}>{online ? "Send to the office" : "Send when back online"}</button>
      </div>
    </section>
  );
}

function CheckItem({ item, value, onChange }: { item: Item; value: { result: string; note: string }; onChange: (p: Partial<{ result: string; note: string }>) => void }) {
  const id = useId();
  const [noteOpen, setNoteOpen] = useState(!!value.note);
  const needsNote = value.result === "ATTENTION" || value.result === "FAIL";
  return (
    <li className="fk-item">
      <fieldset>
        <legend>{item.prompt}</legend>
        <div className="fk-seg">
          {RESULTS.map((r) => (
            <label key={r} className={`fk-seg-opt ${value.result === r ? `on ${r}` : ""}`}>
              <input type="radio" name={id} value={r} checked={value.result === r} onChange={() => onChange({ result: r })} />
              <span title={RESULT_WORDS[r]}>{SHORT[r]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {needsNote || noteOpen ? (
        <label className="field"><span className="small">{needsNote ? "What did you find?" : "Note"}</span><textarea rows={2} maxLength={1000} value={value.note} onChange={(e) => onChange({ note: e.target.value })} /></label>
      ) : <button type="button" className="btn small fk-addnote" onClick={() => setNoteOpen(true)}>Add a note</button>}
    </li>
  );
}

function FindingForm({ onAdd, onCancel }: { onAdd: (f: Finding) => void; onCancel: () => void }) {
  const [f, setF] = useState<Omit<Finding, "clientId">>({ title: "", severity: "", safetyRisk: false, location: "", description: "", recommendedAction: "", estimatedCost: "" });
  const set = (k: keyof typeof f, v: string | boolean) => setF({ ...f, [k]: v });
  return (
    <div className="fk-finding stack">
      <label className="field"><span>What is wrong</span><input maxLength={200} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="For example: water stain on the bedroom ceiling" /></label>
      <div className="fk-grid">
        <label className="field"><span>How serious</span>
          <select value={f.severity} onChange={(e) => set("severity", e.target.value)}><option value="">Choose…</option>{Object.entries(SEVERITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="field"><span>Where</span><input maxLength={200} value={f.location} onChange={(e) => set("location", e.target.value)} /></label>
      </div>
      <label className="fk-check"><input type="checkbox" checked={f.safetyRisk} onChange={(e) => set("safetyRisk", e.target.checked)} /><span>This is a safety risk</span></label>
      <details className="inline"><summary>More about it</summary>
        <div className="stack">
          <label className="field"><span>Description</span><textarea rows={2} maxLength={3000} value={f.description} onChange={(e) => set("description", e.target.value)} /></label>
          <label className="field"><span>Recommended action</span><input maxLength={2000} value={f.recommendedAction} onChange={(e) => set("recommendedAction", e.target.value)} /></label>
          <label className="field"><span>Estimated cost to fix (₦)</span><input inputMode="numeric" maxLength={20} value={f.estimatedCost} onChange={(e) => set("estimatedCost", e.target.value)} /></label>
        </div>
      </details>
      <div className="row">
        <button type="button" className="btn primary" onClick={() => {
          if (f.title.trim().length < 3) { toast.error("Name the defect"); return; }
          if (!f.severity) { toast.error("Choose how serious it is"); return; }
          if (f.estimatedCost && !/^[\d,]+(\.\d{1,2})?$/.test(f.estimatedCost.trim())) { toast.error("Enter the cost as a number"); return; }
          onAdd({ ...f, title: f.title.trim(), clientId: newId() });
        }}>Add defect</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
