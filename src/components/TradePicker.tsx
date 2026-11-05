import { TRADES, type Trade } from "@/lib/artisan-rules";

/** Trades as tappable chips (checkboxes named "trades"). */
export function TradePicker({ selected = [], only }: { selected?: string[]; only?: Trade[] }) {
  const keys = (only ?? (Object.keys(TRADES) as Trade[]));
  return (
    <fieldset className="choice-row trade-picker">
      <legend className="small muted">Trades (up to six)</legend>
      {keys.map((k) => (
        <label key={k} className="chip-choice"><input type="checkbox" name="trades" value={k} defaultChecked={selected.includes(k)} /><span>{TRADES[k]}</span></label>
      ))}
    </fieldset>
  );
}
