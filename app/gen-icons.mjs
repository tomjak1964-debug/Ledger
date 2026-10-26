// Render the app logo (public/logo.svg, "Double Entry") into every icon the app
// ships: the browser-tab favicon, the PWA icons, the maskable icon (the mark
// inside the safe zone on full-bleed navy), the Apple touch icon, and the
// Capacitor asset sources. Run: node gen-icons.mjs
import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync } from "fs";

const svg = readFileSync("public/logo.svg");
const png = (size) => sharp(svg, { density: 512 }).resize(size, size).png().toBuffer();
const NAVY = "#13233B";

for (const [file, size] of [["pwa-64x64-v2.png", 64], ["pwa-192x192-v2.png", 192], ["pwa-512x512-v2.png", 512]])
  writeFileSync("public/" + file, await png(size));

// Apple and maskable icons are cropped by the OS: square corners, mark inset.
const inset = async (size, mark) => sharp({ create: { width: size, height: size, channels: 4, background: NAVY } })
  .composite([{ input: await png(mark), gravity: "center" }]).png().toBuffer();
writeFileSync("public/apple-touch-icon-180x180-v2.png", await inset(180, 160));
writeFileSync("public/maskable-icon-512x512-v2.png", await inset(512, 380));

// favicon-v2.ico: one 48x48 PNG inside an ICO container (browsers read PNG-in-ICO).
const p48 = await png(48);
const head = Buffer.alloc(22);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);       // ICONDIR: reserved, type icon, 1 image
head.writeUInt8(48, 6); head.writeUInt8(48, 7); head.writeUInt8(0, 8); head.writeUInt8(0, 9);
head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);                              // planes, bit depth
head.writeUInt32LE(p48.length, 14); head.writeUInt32LE(22, 18);                     // size, offset
writeFileSync("public/favicon-v2.ico", Buffer.concat([head, p48]));

// Capacitor sources: 1024 icon and a 2732 splash with the mark on navy.
mkdirSync("resources", { recursive: true });
writeFileSync("resources/icon.png", await png(1024));
await sharp({ create: { width: 2732, height: 2732, channels: 4, background: NAVY } })
  .composite([{ input: await png(820), gravity: "center" }]).png().toFile("resources/splash.png");

console.log("icons written");
