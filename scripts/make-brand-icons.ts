/**
 * Draws every icon file from the logo in src/lib/brand.ts, so the browser tab, home-screen and app icons always match the
 * logo on the site. Run after changing the logo:  npx tsx scripts/make-brand-icons.ts
 * Writes src/app/icon.svg, src/app/favicon.ico (16, 32, 48), src/app/apple-icon.png (180) and public/icons/*.png.
 */
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { BRAND, markSvg } from "../src/lib/brand";

let browser: Awaited<ReturnType<typeof chromium.launch>>;

async function png(svg: string, size: number): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`)}</body></html>`);
  const out = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  return out;
}

/** A Windows icon file holding PNG images (every current browser reads these). */
function ico(images: { size: number; data: Buffer }[]): Buffer {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach((im, k) => {
    const e = 6 + 16 * k;
    head.writeUInt8(im.size >= 256 ? 0 : im.size, e); head.writeUInt8(im.size >= 256 ? 0 : im.size, e + 1);
    head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3); head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(im.data.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += im.data.length;
  });
  return Buffer.concat([head, ...images.map((i) => i.data)]);
}

async function main() {
  browser = await chromium.launch();
  try {
  writeFileSync("src/app/icon.svg", markSvg({ stroke: BRAND.strokeSmall }) + "\n");
  const small = markSvg({ stroke: BRAND.strokeSmall });
  writeFileSync("src/app/favicon.ico", ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(size <= 32 ? small : markSvg(), size) })))));
  // Apple and maskable icons are full squares: the phone rounds or crops the corners itself. Maskable keeps the mark inside the
  // central safe zone so no launcher shape cuts it.
  writeFileSync("src/app/apple-icon.png", await png(markSvg({ tile: false, padding: 6 }), 180));
  writeFileSync("public/icons/icon-192.png", await png(markSvg(), 192));
  writeFileSync("public/icons/icon-512.png", await png(markSvg(), 512));
  writeFileSync("public/icons/maskable-512.png", await png(markSvg({ tile: false, padding: 10 }), 512));
  } finally {
    await browser.close();
  }
  console.log("Icons written.");
}

void main();
