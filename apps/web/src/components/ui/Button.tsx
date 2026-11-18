import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/design/cn";
import { Icon, type IconName } from "./Icon";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "accent";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "focus-ring relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold " +
  "transition-[background-color,color,box-shadow,transform,opacity] duration-[var(--vx-dur-fast)] ease-out " +
  "active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 aria-disabled:cursor-not-allowed";

const variants: Record<ButtonVariant, string> = {
  // Ink-black: the one primary action on a screen.
  primary: "bg-ink text-on-ink hover:bg-ink/90 disabled:bg-surface-3 disabled:text-ink-3",
  // Outlined on paper.
  secondary:
    "bg-surface text-ink shadow-[inset_0_0_0_1px_var(--vx-line)] hover:bg-surface-2 disabled:text-ink-3 disabled:bg-surface-2",
  ghost: "bg-transparent text-ink hover:bg-surface-2 disabled:text-ink-3",
  destructive: "bg-danger text-on-danger hover:bg-danger/90 disabled:bg-surface-3 disabled:text-ink-3",
  // Reserved for money moments (e.g. "Recommend Lena's" after you got paid). Use rarely.
  accent: "bg-accent text-on-accent hover:bg-accent/90 disabled:bg-surface-3 disabled:text-ink-3",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-11 rounded-sm px-4 text-body-sm",
  md: "h-12 rounded-md px-5 text-body",
  lg: "h-14 rounded-lg px-6 text-[1.0625rem]",
};

export interface ButtonClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
}

/** Class string for non-button elements that must look like a Button (e.g. next/link). */
export function buttonClasses({ variant = "primary", size = "md", block, className }: ButtonClassOptions = {}) {
  return cn(base, variants[variant], sizes[size], block && "w-full", className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonClassOptions {
  /** Shows a spinner, sets aria-busy and blocks clicks. Label stays (or swaps to loadingLabel). */
  loading?: boolean;
  loadingLabel?: ReactNode;
  leadingIcon?: IconName;
  trailingIcon?: IconName;
}

export function Button({
  variant = "primary",
  size = "md",
  block,
  loading = false,
  loadingLabel,
  leadingIcon,
  trailingIcon,
  disabled,
  className,
  children,
  type = "button",
  onClick,
  ...rest
}: ButtonProps) {
  const iconSize = size === "sm" ? 16 : 20;
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, block, className })}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden
          className="size-4 animate-vx-spin rounded-full border-2 border-current border-r-transparent opacity-80"
        />
      ) : leadingIcon ? (
        <Icon name={leadingIcon} size={iconSize} className="shrink-0" />
      ) : null}
      <span>{loading && loadingLabel ? loadingLabel : children}</span>
      {!loading && trailingIcon ? <Icon name={trailingIcon} size={iconSize} className="shrink-0" /> : null}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** Required accessible name. */
  label: string;
  variant?: "ghost" | "secondary";
}

/** 48×48 hit area, icon only. */
export function IconButton({ icon, label, variant = "ghost", className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "focus-ring inline-flex size-12 items-center justify-center rounded-full text-ink transition-colors duration-[var(--vx-dur-fast)]",
        variant === "ghost" ? "hover:bg-surface-2" : "bg-surface shadow-[inset_0_0_0_1px_var(--vx-line)] hover:bg-surface-2",
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={22} />
    </button>
  );
}
