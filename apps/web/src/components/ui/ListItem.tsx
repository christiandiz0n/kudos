import type { ReactNode } from "react";
import { cn } from "@/design/cn";
import { Icon } from "./Icon";

export interface ListItemProps {
  /** Usually <Avatar/>. */
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  /** Usually <AmountDisplay/>. */
  trailing?: ReactNode;
  /** Small line under the trailing amount ("cashback", "pending"). */
  trailingMeta?: ReactNode;
  /** Makes the whole row a button (48px+ tall). */
  onClick?: () => void;
  /** Render as a link (any element via render prop is overkill: pass href for <a>). */
  href?: string;
  chevron?: boolean;
  className?: string;
}

export function ListItem({ leading, title, meta, trailing, trailingMeta, onClick, href, chevron, className }: ListItemProps) {
  const inner = (
    <>
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-body font-medium text-ink">{title}</span>
        {meta ? <span className="block truncate text-caption text-ink-3">{meta}</span> : null}
      </span>
      {trailing || trailingMeta ? (
        <span className="flex shrink-0 flex-col items-end">
          {trailing}
          {trailingMeta ? <span className="text-caption text-ink-3">{trailingMeta}</span> : null}
        </span>
      ) : null}
      {chevron ? <Icon name="chevronRight" size={18} className="shrink-0 text-ink-3" /> : null}
    </>
  );
  const cls = cn("flex min-h-14 w-full items-center gap-3 py-2.5", className);
  const interactive = cn(
    cls,
    "focus-ring -mx-2 w-[calc(100%+1rem)] rounded-md px-2 transition-colors duration-[var(--vx-dur-fast)] hover:bg-surface-2",
  );
  if (href) return <a href={href} className={interactive}>{inner}</a>;
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={interactive}>
        {inner}
      </button>
    );
  return <div className={cls}>{inner}</div>;
}

/** Vertical list with hairline separators. Children should be <li><ListItem/></li>. */
export function List({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <ul aria-label={label} className={cn("divide-y divide-line", className)}>
      {children}
    </ul>
  );
}
