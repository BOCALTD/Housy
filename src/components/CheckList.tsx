/** A list of checkboxes that shows the first few and folds the rest behind "Show more", so long lists never stretch the form. */
export function CheckList({ name, items, checked = [], limit = 8, noun = "more" }: { name: string; items: { id: string; label: string; hint?: string }[]; checked?: string[]; limit?: number; noun?: string }) {
  const box = (i: { id: string; label: string; hint?: string }) => (
    <label key={i.id} className="check"><input type="checkbox" name={name} value={i.id} defaultChecked={checked.includes(i.id)} /> <span>{i.label}{i.hint ? <span className="small muted"> {i.hint}</span> : null}</span></label>
  );
  const first = items.slice(0, limit), rest = items.slice(limit);
  const restChecked = rest.filter((i) => checked.includes(i.id)).length;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="check-grid">{first.map(box)}</div>
      {rest.length ? (
        <details className="inline">
          <summary>Show {rest.length} {noun}{restChecked ? ` (${restChecked} ticked)` : ""}</summary>
          <div className="check-grid">{rest.map(box)}</div>
        </details>
      ) : null}
    </div>
  );
}
