/**
 * Plain-English messages for any check that does not carry its own (most do). Zod's built-in wording ("Too big: expected
 * string to have <=200 characters") is for developers; people filling in a form see these instead. Loaded once, on the
 * server, before any form is checked (imported by db.ts).
 */
import { z } from "zod";
import { friendlyMessage } from "./friendly-messages";

z.config({ customError: (iss) => friendlyMessage(iss as unknown as Parameters<typeof friendlyMessage>[0]) });
