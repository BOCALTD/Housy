import { formatDateTime, zoneLabel } from "@/lib/dates";
import type { MaintenanceWindow } from "@/lib/site-maintenance-rules";

/** The page everyone except platform administrators sees while Housy is being upgraded. */
export function MaintenancePage({ window: w, name }: { window: MaintenanceWindow; name: string }) {
  return <main id="main" tabIndex={-1} className="maint-page"><MaintenanceCard window={w} name={name} /></main>;
}

export function MaintenanceCard({ window: w, name }: { window: MaintenanceWindow; name: string }) {
  return (
    <section className="card stack maint-card" aria-labelledby="maint-h" data-qa="maint-page">
      <div className="maint-ico" aria-hidden="true">🛠️</div>
      <h1 id="maint-h">{name} is being upgraded</h1>
      <p>We expect to be back by <strong>{formatDateTime(w.end)}</strong> ({zoneLabel(w.end)}).</p>
      {w.message ? <p className="muted">{w.message}</p> : null}
      <p className="small muted">Your account and data are safe. Payments made before the upgrade began are confirmed when the site reopens. Refresh this page later.</p>
      <p className="small"><a href="/login">Housy staff sign in</a></p>
    </section>
  );
}

/** A strip at the top of every page in the day before maintenance (and, for administrators, while it is on). Not floating. */
export function MaintenanceBanner({ window: w, active }: { window: MaintenanceWindow; active: boolean }) {
  return (
    <aside className="maint-banner" role="status" aria-label="Planned maintenance" data-qa="maint-banner">
      <div className="wrap">
        {active
          ? <span><strong>Maintenance is on.</strong> Only platform administrators can see the site until {formatDateTime(w.end)}. Forms outside the admin pages are paused.</span>
          : <span><strong>Planned maintenance:</strong> Housy will be closed from {formatDateTime(w.start)} to {formatDateTime(w.end)} ({zoneLabel(w.end)}).{w.message ? ` ${w.message}` : ""}</span>}
      </div>
    </aside>
  );
}
