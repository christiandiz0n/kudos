// Turn a screenshot's QR region into a 640×480 Y4M clip for Chrome's --use-file-for-fake-video-capture (in-app scanner test).
//   node e2e/phase3/png-to-y4m.mjs <in.png> <out.y4m> <x> <y> <size>
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = new URL("../..", import.meta.url).pathname;
const { PNG } = createRequire(join(ROOT, "node_modules/.pnpm/pngjs@5.0.0/node_modules/pngjs/package.json"))("pngjs");
const [inp, out, x0, y0, sz] = process.argv.slice(2);
const png = PNG.sync.read(readFileSync(inp));
const W = 640, H = 480, S = 360, ox = (W - S) / 2, oy = (H - S) / 2;
const Y = Buffer.alloc(W * H, 235);
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const sx = Math.floor(+x0 + (x * +sz) / S), sy = Math.floor(+y0 + (y * +sz) / S);
  const i = (sy * png.width + sx) * 4;
  const l = 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2];
  Y[(oy + y) * W + ox + x] = l < 128 ? 16 : 235;
}
const UV = Buffer.alloc((W / 2) * (H / 2), 128);
const frame = Buffer.concat([Buffer.from("FRAME\n"), Y, UV, UV]);
const frames = [];
for (let i = 0; i < 30; i++) frames.push(frame);
writeFileSync(out, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), ...frames]));
console.log("wrote", out);
