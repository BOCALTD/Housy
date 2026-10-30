# Housy brand

**Housy** helps people in Nigeria find property they can trust, and gives agents and property companies one place to run their
work. The name says "house" before anyone reads a word of description, and it is friendly enough for a first-time renter while
the product behind it serves companies too.

## Name

- In sentences, write **Housy**: capital H, never "HOUSY", "housy" or "Housy.ng".
- In the logo the wordmark is set in lower case: **housy**.
- Tagline: **Find property you can trust.**
- The name comes from `NEXT_PUBLIC_PLATFORM_NAME`, which defaults to Housy. Leave it unset in production.

## Logo

The mark is a lower-case **h whose shoulder is a gabled roof**, with one lit **amber doorway**: the first letter of the name and
a house drawn as a single line. The full logo is the mark followed by the wordmark **housy** (Inter Display SemiBold, tightened,
stored as outlines so it never depends on a font loading).

| Use | What to show |
| --- | --- |
| Header, footer, sign-in, loader, welcome slides, emails, share pictures | Full logo |
| Browser tab, home-screen and app icon, avatars, small badges | Mark on the ink tile |

- Files: `public/brand/housy-logo.svg` (ink), `housy-logo-white.svg` (for dark backgrounds), `housy-mark.svg` (app tile) and
  `housy-logo-email.png`. Give these to partners and the press.
- The shapes live only in `src/lib/brand.ts`. After changing them, run `npx tsx scripts/make-brand-icons.ts` to redraw every
  icon and logo file.
- Clear space: at least the width of the doorway times three on every side.
- Smallest sizes: 16 px for the tile, 22 px tall for the full logo.
- Ink logo on light backgrounds, white logo on dark backgrounds and photos with a dark panel. The doorway is always amber.
- Do not stretch, rotate, outline, recolour the doorway, add effects, retype the wordmark in another font, or set the mark
  inside a different shape. The one sanctioned effect: on hover the doorway lights up.

## Colours

| Name | Hex | Use |
| --- | --- | --- |
| Ink | `#1F2125` | Logo, app tile, dark panels, text on amber |
| Doorway amber | `#F2A007` | The doorway in the logo |
| Housy amber | `#FBB017` | Main buttons, highlights |
| Grey | `#C9CDD3` | Secondary text on dark panels |
| Paper | `#FAF8F4` | Light brand backgrounds |

Amber is the accent, never the background of the logo. Text on amber is always ink, never white: white on amber fails contrast.

## Type

- Wordmark: **Inter Display SemiBold**, as outlines. Headings on the site: **Bricolage Grotesque**.
- Body: **Instrument Sans**. Figures and codes: **IBM Plex Mono**.
- Share pictures and emails use **Inter** and Arial, because those draw without downloading a font.

## Voice

Plain, warm and specific. Say what something does and what it costs; never promise a property is safe, only what was checked.
