import { captchaFor } from "@/lib/captcha";
import type { CaptchaPlace } from "@/lib/services/platform-config";
import { CaptchaWidget } from "./CaptchaWidget";

/** The person check for a form, when the administrator has turned one on for this place; nothing otherwise. */
export async function Captcha({ place }: { place: CaptchaPlace }) {
  const c = await captchaFor(place);
  return c ? <CaptchaWidget provider={c.provider} siteKey={c.siteKey} place={place} /> : null;
}
