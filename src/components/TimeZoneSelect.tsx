import { timeZoneNames } from "@/lib/services/business-region";
import { Field } from "./ui";

/** A time zone, or "automatic" (the empty value) with what that currently means. */
export function TimeZoneSelect({ value, automatic, name = "timeZone", label = "Time zone" }: { value: string; automatic: string; name?: string; label?: string }) {
  return (
    <Field label={label} hint="Dates and times are shown in it.">
      <select name={name} defaultValue={value}>
        <option value="">Automatic ({automatic.replace(/_/g, " ")})</option>
        {timeZoneNames().map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
      </select>
    </Field>
  );
}
