// Sprint UI — genera los iconos PWA desde public/isotipo.png
// (sustituye los placeholders de 1×1 px). Uso: node scripts/gen-pwa-icons.mjs
// Maskable: fondo pleno + logo centrado al 66% (zona segura del 80%).
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const logo = await loadImage(resolve(ROOT, "public/isotipo.png"));

function make(size, { scale = 0.66, bg = "#fafbfc" } = {}) {
  const c = createCanvas(size, size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  const w = size * scale;
  const h = w * (logo.height / logo.width);
  ctx.drawImage(logo, (size - w) / 2, (size - h) / 2, w, h);
  return c.toBuffer("image/png");
}

writeFileSync(resolve(ROOT, "public/icon-192.png"), make(192));
writeFileSync(resolve(ROOT, "public/icon-512.png"), make(512));
writeFileSync(resolve(ROOT, "public/apple-icon.png"), make(180, { scale: 0.72 }));
writeFileSync(resolve(ROOT, "public/badge-72.png"), make(72, { scale: 0.8 }));
console.log("Iconos generados: icon-192, icon-512, apple-icon (180), badge-72");
