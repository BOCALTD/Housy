import { CALLING_CODES, flag } from "@/lib/phone-rules";
import { COUNTRY_GROUPS } from "@/lib/countries";

/**
 * A phone number with its country: pick the country code, then type the number the way it is dialled there (0803 123 4567 in
 * Nigeria, 024 123 4567 in Ghana). The server turns it into one international number, so the same person is recognised
 * whichever way the number was written. A number typed with + and its code is taken as it is.
 */
export function PhoneField({ label, name = "phone", country = "NG", defaultValue = "", required = false, hint, placeholder = "0803 123 4567", autoComplete = "tel", id }: {
  label: string; name?: string; country?: string; defaultValue?: string; required?: boolean; hint?: string; placeholder?: string; autoComplete?: string; id?: string;
}) {
  const opt = ([c, n]: readonly [string, string]) => CALLING_CODES[c] ? <option key={c} value={c}>{flag(c)} +{CALLING_CODES[c]} {n}</option> : null;
  return (
    <div className="field phone-field">
      <label htmlFor={id ?? name}>{label}</label>
      <div className="phone-row">
        <select name={`${name}Country`} defaultValue={CALLING_CODES[country] ? country : "NG"} aria-label={`${label}: country code`} className="phone-cc">
          <optgroup label="Common">{COUNTRY_GROUPS.popular.map(opt)}</optgroup>
          <optgroup label="All countries">{COUNTRY_GROUPS.all.map(opt)}</optgroup>
        </select>
        <input id={id ?? name} name={name} type="tel" inputMode="tel" maxLength={30} required={required} autoComplete={autoComplete} placeholder={placeholder} defaultValue={defaultValue} />
      </div>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}
