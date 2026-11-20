/**
 * WCAG 2.x contrast check for the Vouch text tokens (UI_DESIGN).
 * Reads src/design/tokens.css, resolves the light and dark palettes, prints a markdown table.
 * Run: node scripts/contrast.ts   (Node >= 23 strips TS types natively)
 * Exit code 1 if any required pair fails its threshold.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../src/design/tokens.css"), "utf8");

function block(selectorStart: string): Record<string, string> {
  const i = css.indexOf(selectorStart);
  if (i < 0) throw new Error(`selector not found: ${selectorStart}`);
  const open = css.indexOf("{", i);
  const close = css.indexOf("}", open);
  const out: Record<string, string> = {};
  for (const m of css.slice(open + 1, close).matchAll(/--vx-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}

const light = block(':root,\n[data-theme="light"]');
const dark = block('\n[data-theme="dark"]');

function lum(hex: string): number {
  const c = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// [foreground, background, min ratio, usage]
const pairs: Array<[string, string, number, string]> = [
  ["ink", "canvas", 4.5, "Body text on app background"],
  ["ink", "surface", 4.5, "Body text on cards/sheets"],
  ["ink-2", "canvas", 4.5, "Secondary text"],
  ["ink-2", "surface", 4.5, "Secondary text on cards"],
  ["ink-2", "accent-soft", 4.5, "Body copy inside green cards"],
  ["ink-3", "canvas", 4.5, "Meta/captions"],
  ["ink-3", "surface", 4.5, "Meta/captions on cards"],
  ["ink-3", "surface-2", 4.5, "Meta on sunken wells"],
  ["on-ink", "ink", 4.5, "Primary button label"],
  ["on-primary", "primary", 4.5, "Primary button label (white on blue)"],
  ["on-primary", "primary-hover", 4.5, "Primary button label, hover"],
  ["on-primary", "primary-pressed", 4.5, "Primary button label, pressed"],
  ["primary-ink", "canvas", 4.5, "Blue text / links on background"],
  ["primary-ink", "surface", 4.5, "Blue text / links on cards"],
  ["primary-ink", "primary-soft", 4.5, "Blue text on tinted (selected) rows"],
  ["primary-ink", "primary-soft-2", 4.5, "Blue text on selected chips"],
  ["ink", "primary-soft", 4.5, "Body text on blue tint"],
  ["ink-2", "primary-soft", 4.5, "Secondary text on blue tint"],
  ["primary", "surface", 3, "Blue graphics/strokes (non-text)"],
  ["primary", "canvas", 3, "Blue graphics on background (non-text)"],
  ["accent-ink", "canvas", 4.5, "Green amounts (+$0.45) on background"],
  ["accent-ink", "surface", 4.5, "Green amounts on cards"],
  ["accent-ink", "accent-soft", 4.5, "Cashback chip text"],
  ["on-accent", "accent", 4.5, "Text on accent fill (badges)"],
  ["accent", "surface", 3.0, "Accent graphics/strokes (non-text)"],
  ["warning-ink", "warning-soft", 4.5, "Warning banner text"],
  ["warning-ink", "surface", 4.5, "Warning text on cards"],
  ["danger-ink", "danger-soft", 4.5, "Error banner text"],
  ["danger-ink", "surface", 4.5, "Error text on cards"],
  ["on-danger", "danger", 4.5, "Destructive button label"],
  ["line-strong", "surface", 3.0, "Input borders (non-text, 1.4.11)"],
  ["focus", "canvas", 3.0, "Focus ring vs background (non-text)"],
  ["focus", "surface", 3.0, "Focus ring vs card (non-text)"],
];

let failed = 0;
const rows: string[] = [];
for (const [fg, bg, min, usage] of pairs) {
  const cells: string[] = [];
  for (const pal of [light, dark]) {
    const f = pal[fg];
    const b = pal[bg];
    if (!f || !b) {
      cells.push(`n/a`);
      continue;
    }
    const r = ratio(f, b);
    const ok = r >= min;
    if (!ok) failed++;
    cells.push(`${r.toFixed(2)}:1 ${ok ? "PASS" : "**FAIL**"}`);
  }
  rows.push(`| \`${fg}\` on \`${bg}\` | ${usage} | ${min}:1 | ${cells[0]} | ${cells[1]} |`);
}
console.log("| Pair | Usage | Min | Light | Dark |\n|---|---|---|---|---|\n" + rows.join("\n"));
if (failed) {
  console.error(`\n${failed} pair(s) below threshold`);
  process.exit(1);
}
