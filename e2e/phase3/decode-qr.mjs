// Decode a QR from a screenshot PNG independently of the app (jsQR + pngjs from the pnpm store).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = new URL("../..", import.meta.url).pathname;
const req = createRequire(join(ROOT, "node_modules/.pnpm/jsqr@1.4.0/node_modules/jsqr/package.json"));
const jsQR = req("jsqr");
const { PNG } = createRequire(join(ROOT, "node_modules/.pnpm/pngjs@5.0.0/node_modules/pngjs/package.json"))("pngjs");
const png = PNG.sync.read(readFileSync(process.argv[2]));
const r = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
console.log(r ? r.data : "NO QR FOUND");
