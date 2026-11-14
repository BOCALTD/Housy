import { COUNTRIES, COUNTRY_CODES, CURRENCIES, isCountry } from "@/lib/regions";
import { Field } from "./ui";

/** Where a business works: it sets the currency of its prices, payments and plan, and how clients pay it. */
export function BusinessCountry({ value, name = "country", label = "Country where you do business", disabled, hint = "Your prices, payments and plan are in this country's currency." }: { value?: string; name?: string; label?: string; disabled?: boolean; hint?: string }) {
  const v = value && isCountry(value) ? value : "NG";
  return (
    <Field label={label} hint={hint}>
      <select name={name} defaultValue={v} disabled={disabled} autoComplete="country">
        {COUNTRY_CODES.map((c) => <option key={c} value={c}>{COUNTRIES[c].name} ({CURRENCIES[COUNTRIES[c].currency].symbol.trim()} {COUNTRIES[c].currency})</option>)}
      </select>
    </Field>
  );
}
