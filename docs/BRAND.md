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

The mark is an **H standing under a roof** on an amber tile: a house, and the first letter of the name. The full logo is the
mark followed by the wordmark.

| Use | What to show |
| --- | --- |
| Header, footer, sign-in, loader, welcome slides, emails, share pictures | Mark and wordmark |
| Browser tab, home-screen icon, app icon, avatars | Mark only |

- The shapes live only in `src/lib/brand.ts`. Change them there, then run `npx tsx scripts/make-brand-icons.ts` to redraw the
  favicon, app icons and `icon.svg`.
- Keep clear space around the logo of at least a quarter of the mark's height.
- Smallest size: 16 px for the mark (the tab icon uses thicker lines), 24 px for the full logo.
- On dark backgrounds the wordmark is white; the mark stays amber with dark lines.
- Do not stretch, rotate, outline, add shadows inside the tile, recolour the tile, or put the mark on a busy photo without a
  dark panel behind it.

## Colours

| Name | Hex | Use |
| --- | --- | --- |
| Housy amber | `#FBB017` | Tile, main buttons, highlights |
| Deep amber | `#F29F05` | Hover, gradients |
| Ink | `#1F2125` | Lines of the mark, dark panels, text on amber |
| Grey | `#C9CDD3` | Secondary text on dark panels |

Text on amber is always ink, never white: white on amber fails contrast.

## Type

- Display and wordmark: **Bricolage Grotesque**, bold, tight letter spacing.
- Body: **Instrument Sans**. Figures and codes: **IBM Plex Mono**.
- Share pictures and emails use **Inter** and Arial, because those draw without downloading a font.

## Voice

Plain, warm and specific. Say what something does and what it costs; never promise a property is safe, only what was checked.
