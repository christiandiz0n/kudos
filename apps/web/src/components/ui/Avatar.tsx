import { cn } from "@/design/cn";

export type AvatarSize = "xs" | "sm" | "md" | "lg";

const sizes: Record<AvatarSize, string> = {
  xs: "size-6 text-[0.625rem]",
  sm: "size-8 text-micro",
  md: "size-10 text-caption",
  lg: "size-14 text-title-3",
};

/**
 * Muted identity tints (--vx-tint-1..6, not accents): soft tones so the faces of the network feel
 * local and human without competing with the green. Ink text on all of them is ≥ 9:1.
 */
// Literal class names so Tailwind's scanner sees them.
const TINTS = [
  "bg-[var(--vx-tint-1)]",
  "bg-[var(--vx-tint-2)]",
  "bg-[var(--vx-tint-3)]",
  "bg-[var(--vx-tint-4)]",
  "bg-[var(--vx-tint-5)]",
  "bg-[var(--vx-tint-6)]",
];

export function initials(name: string): string {
  const words = name.replace(/['’]s\b/g, "").split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

function tintFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

export interface AvatarProps {
  name: string;
  size?: AvatarSize;
  /** `venue` renders a rounded square (a storefront), people are circles. `you` gets a green ring. */
  kind?: "person" | "venue" | "you";
  className?: string;
  /** Decorative when the name is printed next to it (default). */
  decorative?: boolean;
}

export function Avatar({ name, size = "md", kind = "person", className, decorative = true }: AvatarProps) {
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-semibold text-ink select-none",
        sizes[size],
        kind === "venue" ? "rounded-[30%]" : "rounded-full",
        kind === "you" ? "bg-primary-soft text-primary-ink ring-2 ring-primary ring-offset-2 ring-offset-surface" : tintFor(name),
        className,
      )}
    >
      {kind === "you" && /^you$/i.test(name) ? <span className="text-[0.85em]">You</span> : initials(name)}
    </span>
  );
}

/** Overlapping avatars for "Ana and Priya recommended this". */
export function AvatarStack({ names, size = "sm", max = 3 }: { names: string[]; size?: AvatarSize; max?: number }) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <span className="inline-flex items-center" aria-hidden>
      {shown.map((n, i) => (
        <Avatar key={n + i} name={n} size={size} className={cn("ring-2 ring-surface", i > 0 && "-ml-2")} />
      ))}
      {extra > 0 ? (
        <span className={cn("-ml-2 inline-flex items-center justify-center rounded-full bg-surface-3 font-semibold text-ink-2 ring-2 ring-surface", sizes[size])}>
          +{extra}
        </span>
      ) : null}
    </span>
  );
}
