/** WCAG 2.x contrast helpers + a tokens.css palette parser (used by /design; scripts/contrast.ts mirrors it). */
export type Palette = Record<string, string>;

export function parsePalette(css: string, selectorStart: string): Palette {
  const i = css.indexOf(selectorStart);
  if (i < 0) return {};
  const open = css.indexOf("{", i);
  const close = css.indexOf("}", open);
  const out: Palette = {};
  for (const m of css.slice(open + 1, close).matchAll(/--vx-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}

export const LIGHT_SELECTOR = ':root,\n[data-theme="light"]';
export const DARK_SELECTOR = '\n[data-theme="dark"]';

function lum(hex: string): number {
  const c = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** [foreground, background, minimum, usage] */
export const CONTRAST_PAIRS: Array<[string, string, number, string]> = [
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
  ["on-accent", "accent", 4.5, "Text on accent fill"],
  ["accent", "surface", 3, "Accent graphics/strokes (non-text)"],
  ["warning-ink", "warning-soft", 4.5, "Warning banner text"],
  ["danger-ink", "danger-soft", 4.5, "Error banner text"],
  ["danger-ink", "surface", 4.5, "Error text on cards"],
  ["on-danger", "danger", 4.5, "Destructive button label"],
  ["line-strong", "surface", 3, "Input borders (non-text)"],
  ["focus", "canvas", 3, "Focus ring vs background"],
  ["focus", "surface", 3, "Focus ring vs card"],
];
