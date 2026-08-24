// One-off: render the app logo (SVG) into Capacitor asset sources.
import sharp from "sharp";
import { readFileSync, mkdirSync } from "fs";

mkdirSync("resources", { recursive: true });
const svg = readFileSync("public/logo.svg");

// 1024x1024 app icon
await sharp(svg, { density: 512 }).resize(1024, 1024).png().toFile("resources/icon.png");

// 2732x2732 splash: logo centered on the brand navy
const logo = await sharp(svg, { density: 512 }).resize(820, 820).png().toBuffer();
await sharp({ create: { width: 2732, height: 2732, channels: 4, background: "#13233B" } })
  .composite([{ input: logo, gravity: "center" }]).png().toFile("resources/splash.png");

console.log("wrote resources/icon.png and resources/splash.png");
