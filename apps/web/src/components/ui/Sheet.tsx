"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/design/cn";
import { IconButton } from "./Button";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export interface SheetPanelProps {
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Sticky action area (one primary Button, optional secondary). */
  footer?: ReactNode;
  /** Shows a close (×) button in the header. */
  onClose?: () => void;
  titleId?: string;
  descriptionId?: string;
  className?: string;
}

/**
 * The visual bottom-sheet surface without modal behavior. Use it directly for static mocks
 * (inside a phone frame) and inside <Sheet/> in the app.
 */
export function SheetPanel({ title, description, children, footer, onClose, titleId, descriptionId, className }: SheetPanelProps) {
  return (
    <div className={cn("relative w-full rounded-t-xl bg-surface pb-[max(env(safe-area-inset-bottom),16px)] shadow-3", className)}>
      <div className="flex justify-center pt-2.5 pb-1" aria-hidden>
        <span className="h-1 w-10 rounded-full bg-surface-3" />
      </div>
      {title || onClose ? (
        <div className="flex items-start gap-2 px-5 pt-2">
          <div className="min-w-0 flex-1 pt-1.5">
            {title ? (
              <h2 id={titleId} className="text-title-3 text-ink">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p id={descriptionId} className="mt-0.5 text-body-sm text-ink-2">
                {description}
              </p>
            ) : null}
          </div>
          {onClose ? <IconButton icon="close" label="Close" onClick={onClose} className="-mr-2 -mt-1" /> : null}
        </div>
      ) : null}
      <div className="px-5 pt-3">{children}</div>
      {footer ? <div className="px-5 pt-4">{footer}</div> : null}
    </div>
  );
}

export interface SheetProps extends Omit<SheetPanelProps, "titleId" | "descriptionId"> {
  open: boolean;
  onClose: () => void;
  /** Esc, backdrop tap and drag-down close the sheet unless false (e.g. while a payment is submitting). */
  dismissible?: boolean;
  /** Accessible name when `title` is not plain text. */
  ariaLabel?: string;
}

const noopSubscribe = () => () => {};

/**
 * Modal bottom sheet: portal, focus trap, Esc to close, backdrop tap, drag handle to close,
 * restores focus to the opener, locks body scroll. role="dialog" aria-modal.
 */
export function Sheet({ open, onClose, dismissible = true, ariaLabel, title, description, children, footer }: SheetProps) {
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<number | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const requestClose = useCallback(() => {
    if (dismissible) onClose();
  }, [dismissible, onClose]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      requestClose();
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null,
    );
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const firstEl = items[0];
    const lastEl = items[items.length - 1];
    if (e.shiftKey && document.activeElement === firstEl) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!dismissible) return;
    dragStart.current = e.clientY;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragStart.current === null) return;
    setDragY(Math.max(0, e.clientY - dragStart.current));
  };
  const onPointerUp = () => {
    if (dragStart.current === null) return;
    dragStart.current = null;
    setDragging(false);
    if (dragY > 96) onClose();
    setDragY(0);
  };

  if (!open || !isClient) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div aria-hidden className="absolute inset-0 animate-vx-fade-in bg-scrim" onClick={requestClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title && !ariaLabel ? titleId : undefined}
        aria-label={ariaLabel}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="relative w-full max-w-[480px] animate-vx-sheet-in outline-none sm:mb-[max(2rem,calc((100dvh-940px)/2))] sm:max-w-[460px] sm:overflow-hidden sm:rounded-b-xl"
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: !dragging ? "transform var(--vx-dur-base) var(--vx-ease-out)" : "none",
        }}
      >
        {/* Drag zone over the handle */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 z-10 h-6 cursor-grab touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        <SheetPanel
          title={title}
          description={description}
          footer={footer}
          onClose={dismissible ? onClose : undefined}
          titleId={titleId}
          descriptionId={descriptionId}
        >
          {children}
        </SheetPanel>
      </div>
    </div>,
    document.body,
  );
}
