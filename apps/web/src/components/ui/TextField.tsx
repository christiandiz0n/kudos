import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/design/cn";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: string;
  hint?: ReactNode;
  error?: string;
  /** e.g. "$" for money inputs (use inputMode="decimal"). */
  prefix?: string;
}

export function TextField({ label, hint, error, prefix, className, id, ...rest }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={inputId} className="text-body-sm font-medium text-ink-2">
        {label}
      </label>
      <div
        className={cn(
          "flex h-12 items-center gap-1 rounded-md bg-surface px-3.5 shadow-[inset_0_0_0_1px_var(--vx-line-strong)] focus-within:shadow-[inset_0_0_0_2px_var(--vx-focus)]",
          error && "shadow-[inset_0_0_0_2px_var(--vx-danger)]",
        )}
      >
        {prefix ? <span className="text-body text-ink-3">{prefix}</span> : null}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? hintId : undefined}
          className="h-full min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-3"
          {...rest}
        />
      </div>
      {error ? (
        <p id={hintId} className="text-caption text-danger-ink">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-caption text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
