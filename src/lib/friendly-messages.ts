/**
 * Plain-English wording for form checks that carry no message of their own (wired up in zod-messages.ts). Pure, tested on its own.
 */
type Issue = { code: string; input?: unknown; expected?: string; origin?: string; maximum?: number | bigint; minimum?: number | bigint; format?: string };

export function friendlyMessage(iss: Issue): string | undefined {
  const n = (v: number | bigint | undefined) => (v === undefined ? "" : Number(v).toLocaleString("en-GB"));
  switch (iss.code) {
    case "invalid_type":
      if (iss.input === undefined || iss.input === null || iss.input === "") return "This is required";
      if (iss.expected === "number" || iss.expected === "int" || iss.expected === "bigint") return "Enter a number";
      if (iss.expected === "date") return "Enter a valid date";
      return "Check this value";
    case "too_big":
      if (iss.origin === "string") return `Use at most ${n(iss.maximum)} characters`;
      if (iss.origin === "array" || iss.origin === "set") return `Choose at most ${n(iss.maximum)}`;
      if (iss.origin === "date") return "That date is too late";
      return `Enter ${n(iss.maximum)} or less`;
    case "too_small":
      if (iss.origin === "string") return Number(iss.minimum) <= 1 ? "This is required" : `Use at least ${n(iss.minimum)} characters`;
      if (iss.origin === "array" || iss.origin === "set") return `Choose at least ${n(iss.minimum)}`;
      if (iss.origin === "date") return "That date is too early";
      return `Enter ${n(iss.minimum)} or more`;
    case "invalid_format":
      if (iss.format === "email") return "Enter a valid email address";
      if (iss.format === "url") return "Enter a valid web address";
      if (iss.format === "uuid" || iss.format === "guid" || iss.format === "cuid") return "That record could not be found";
      return "Check the format of this value";
    case "invalid_value":
      return "Choose one of the options";
    case "not_multiple_of":
      return "Enter a whole number in the right steps";
    case "invalid_union":
      return "Check this value";
    default:
      return undefined;
  }
}
