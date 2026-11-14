/**
 * Cookie choices. Essential cookies (signing in, remembering this choice and settings you pick) are always used. Optional ones
 * (counting a property visit once a day, crediting the person who invited you) are set only after you choose "Accept all".
 */
export const CONSENT_COOKIE = "cookie_choice";
export type ConsentChoice = "all" | "essential";
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 365;
export const isConsentChoice = (v: string | undefined | null): v is ConsentChoice => v === "all" || v === "essential";
