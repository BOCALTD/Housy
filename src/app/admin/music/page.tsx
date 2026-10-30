import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { musicForAdmin } from "@/lib/services/music";
import { MUSIC_GENRES, durationLabel } from "@/lib/music-rules";
import { formatDate } from "@/lib/dates";
import { Field, Flash, ShowMore, sp, type SP } from "@/components/ui";
import { addTrackAction, trackActiveAction } from "./actions";
import { TrackListen } from "@/components/TrackListen";

export const metadata = { title: "Music library" };
export const dynamic = "force-dynamic";

export default async function MusicAdminPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const s = await searchP;
  const admin = await requirePlatformAdmin();
  const tracks = await musicForAdmin(admin.id);
  const live = tracks.filter((t) => t.active).length;
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Music library</h1>
        <p className="muted">The songs agents can put under their reels. Add only tracks the platform holds a licence for that allows use in people&apos;s videos on the platform: royalty-free libraries, tracks bought with a sync licence, or music commissioned for the platform. Popular commercial songs need a licence from the labels and must not be added without one. <Link href="/admin/reels">Reel moderation</Link></p>
      </div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      <section className="stats" aria-label="Library">
        <div className="stat"><b>{live}</b><span>Tracks agents can choose</span></div>
        <div className="stat"><b>{tracks.length - live}</b><span>Withdrawn</span></div>
        <div className="stat"><b>{tracks.reduce((n, t) => n + t.uses, 0)}</b><span>Reels using them</span></div>
      </section>

      <details className="card fold-card" open={tracks.length === 0}>
        <summary><h2>Add a track</h2><span className="small muted">MP3, M4A, AAC or OGG, up to 4 MB</span></summary>
        <form action={addTrackAction} className="stack" encType="multipart/form-data">
          <Field label="Audio file"><input type="file" name="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,.mp3,.m4a,.aac,.ogg" required /></Field>
          <div className="two">
            <Field label="Title"><input name="title" required maxLength={120} /></Field>
            <Field label="Artist or composer"><input name="artist" required maxLength={120} /></Field>
          </div>
          <Field label="Style">
            <select name="genre" required defaultValue=""><option value="" disabled>Choose…</option>{Object.entries(MUSIC_GENRES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </Field>
          <Field label="Licence" hint="Its name as the seller or library gives it, and the kind of licence you hold."><input name="licenceName" required maxLength={160} placeholder="For example: Pixabay Content Licence" /></Field>
          <Field label="Where the licence is (optional)" hint="A link to the licence or the receipt."><input name="licenceSource" type="url" maxLength={300} placeholder="https://" /></Field>
          <Field label="Notes (optional)" hint="Order number, limits on use, renewal date."><textarea name="licenceNote" rows={2} maxLength={1000} /></Field>
          <label className="check"><input type="checkbox" name="creditRequired" /><span>The licence asks for the artist to be credited where the track is used (shown on every reel with it).</span></label>
          <label className="check"><input type="checkbox" name="confirmed" /><span>I confirm the platform holds a licence that lets people use this track in reels they post here.</span></label>
          <button className="btn primary" type="submit">Add to the library</button>
        </form>
      </details>

      <section className="card stack" aria-labelledby="tracks-h">
        <h2 id="tracks-h">Tracks</h2>
        {tracks.length === 0 ? <p className="muted">No tracks yet. Agents can post reels without music until you add some.</p> : (
          <ShowMore noun="more tracks" limit={8} items={tracks.map((t) => (
            <li key={t.id}>
              <div className="stack" style={{ gap: 6, width: "100%" }}>
                <div className="row between">
                  <div><strong>{t.title}</strong> <span className="muted">· {t.artist}</span><div className="small muted">{MUSIC_GENRES[t.genre as keyof typeof MUSIC_GENRES] ?? t.genre} · {durationLabel(t.durationSec)} · used in {t.uses} reel{t.uses === 1 ? "" : "s"} · added {formatDate(t.createdAt)}</div></div>
                  <span className={`pill ${t.active ? "ok" : "disc"}`}>{t.active ? "Live" : "Withdrawn"}</span>
                </div>
                {t.active ? <TrackListen id={t.id} title={t.title} /> : null}
                <p className="small">Licence: {t.licenceName}{t.licenceSource ? <> · <a href={t.licenceSource} rel="noopener noreferrer" target="_blank">licence</a></> : null}{t.creditRequired ? " · credit required" : ""}{t.licenceNote ? ` · ${t.licenceNote}` : ""}</p>
                <form action={trackActiveAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="on" value={t.active ? "no" : "yes"} />
                  <button className="btn small" type="submit">{t.active ? "Withdraw" : "Switch back on"}</button></form>
                {t.active ? null : <p className="small muted">Withdrawn tracks stop playing on reels that play them alongside. Reels where the track was mixed into the clip keep it; hide those reels from Reel moderation if the licence has ended.</p>}
              </div>
            </li>
          ))} />
        )}
      </section>
    </div>
  );
}
