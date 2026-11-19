/**
 * An on/off switch that saves when pressed, after a confirm window. It is a form, so it works before the page's scripts load.
 */
export function ToggleSwitch({ on, action, label, name = "on", hidden = {}, confirm }: {
  on: boolean; action: (form: FormData) => Promise<unknown> | void; label: string; name?: string;
  hidden?: Record<string, string>;
  confirm: { title: string; body: string; ok: string };
}) {
  return (
    <form action={action as (form: FormData) => void} className="toggle-form">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input type="hidden" name={name} value={on ? "off" : "on"} />
      <button type="submit" role="switch" aria-checked={on} className={`toggle${on ? " on" : ""}`} data-confirm={confirm.title} data-confirm-body={confirm.body} data-confirm-ok={confirm.ok} data-confirm-tone="default">
        <span className="toggle-track" aria-hidden="true"><span className="toggle-knob" /></span>
        <span className="toggle-label">{label}: <strong>{on ? "On" : "Off"}</strong></span>
      </button>
    </form>
  );
}
