/**
 * Scan to pay (UI_DESIGN, Phase 3). Props-only; FRONTEND_INTEGRATION owns getUserMedia + decoding.
 *
 * PROP CONTRACT (ScanScreenProps)
 *   camera?        ReactNode: the live <video> (object-cover, fills the screen). Mock = dark gradient.
 *   cameraState?   "starting" | "live" (default) | "denied" (NotAllowedError) | "unavailable" (no camera / insecure context)
 *   hint?          status line under the viewfinder (default "Point at the code on the counter screen")
 *   error?         a scan that isn't a Vouch code, e.g. "That code isn't for Vouch. Try the one on the counter screen."
 *   found?         true for ~400ms after a successful decode (frame turns solid, then the caller opens the pay sheet)
 *   manualOpen?    show the paste panel over a live camera (after onEnterCode)
 *   manual?        { value, onChange, onSubmit, error?, submitting? }: paste a code or link. Shown automatically
 *                  when the camera is denied/unavailable.
 *   onClose, onEnterCode, onRetryCamera
 */
import type { ReactNode } from "react";
import { Button, Icon, IconButton, TextField } from "@/components/ui";
import { cn } from "@/design/cn";

export type CameraState = "starting" | "live" | "denied" | "unavailable";

export interface ManualEntry {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  error?: string;
  submitting?: boolean;
}

export interface ScanScreenProps {
  /** The live camera element (FRONTEND_INTEGRATION). The mock renders a dark placeholder. */
  camera?: ReactNode;
  cameraState?: CameraState;
  hint?: string;
  error?: string;
  found?: boolean;
  manualOpen?: boolean;
  manual?: ManualEntry;
  onClose?: () => void;
  onEnterCode?: () => void;
  onRetryCamera?: () => void;
}

const CORNERS = [
  "top-0 left-0 border-t-4 border-l-4 rounded-tl-[28px]",
  "top-0 right-0 border-t-4 border-r-4 rounded-tr-[28px]",
  "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-[28px]",
  "bottom-0 right-0 border-r-4 border-b-4 rounded-br-[28px]",
];

function ManualPanel({ manual, blocked }: { manual?: ManualEntry; blocked: boolean }) {
  return (
    <form
      className="rounded-xl bg-surface p-5 shadow-3"
      onSubmit={(e) => {
        e.preventDefault();
        manual?.onSubmit();
      }}
    >
      {blocked ? null : <p className="mb-3 text-title-3 text-ink">Type or paste the code</p>}
      <TextField
        label="Code or link"
        placeholder="Paste from the counter screen"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={manual?.value ?? ""}
        onChange={(e) => manual?.onChange(e.target.value)}
        error={manual?.error}
        hint="It's the short link printed under the code."
      />
      <Button type="submit" block size="lg" className="mt-4" loading={manual?.submitting} loadingLabel="Checking…" disabled={!manual?.value}>
        Continue
      </Button>
    </form>
  );
}

/** Full-bleed camera with a calm viewfinder. Always dark, regardless of theme (it's a camera). */
export function ScanScreen({
  camera,
  cameraState = "live",
  hint = "Point at the code on the counter screen",
  error,
  found,
  manualOpen,
  manual,
  onClose,
  onEnterCode,
  onRetryCamera,
}: ScanScreenProps) {
  const blocked = cameraState === "denied" || cameraState === "unavailable";
  const showManual = blocked || manualOpen;

  return (
    <div data-theme="dark" className="relative flex h-full min-h-full flex-col overflow-hidden bg-canvas text-ink">
      <div className="absolute inset-0">
        {!blocked && camera ? camera : <div className="size-full bg-[radial-gradient(120%_80%_at_50%_40%,var(--vx-surface-2)_0%,var(--vx-canvas)_70%)]" />}
      </div>
      <div className="relative flex items-center justify-between px-3 pt-3">
        <IconButton icon="close" label="Close scanner" onClick={onClose} />
        <p className="text-body font-semibold">Scan to pay</p>
        <span className="size-12" />
      </div>

      {blocked ? (
        <div className="relative flex flex-1 flex-col justify-end gap-4 overflow-y-auto px-5 pt-4 pb-8">
          <div role="alert" className="px-1">
            <span className="mb-4 inline-flex size-14 items-center justify-center rounded-full bg-surface-2 text-ink-2">
              <Icon name="cameraOff" size={26} />
            </span>
            <h1 className="text-title-2 text-ink">{cameraState === "denied" ? "Camera is off for Kudos" : "No camera available"}</h1>
            <p className="mt-2 text-body text-ink-2">
              {cameraState === "denied"
                ? "That's fine, there are two other ways to pay:"
                : "This browser can't use a camera here. There are two other ways to pay:"}
            </p>
            <ol className="mt-4 space-y-3 text-body text-ink">
              <li className="flex gap-3">
                <span className="money inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-body-sm font-semibold">1</span>
                <span>
                  Open your phone&apos;s <span className="font-semibold">camera app</span>, point it at the code and tap the link that appears.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="money inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-body-sm font-semibold">2</span>
                <span>Or type the short link from the counter screen below.</span>
              </li>
            </ol>
          </div>
          <ManualPanel manual={manual} blocked />
          {cameraState === "denied" ? (
            <Button block variant="ghost" leadingIcon="camera" onClick={onRetryCamera}>
              Try the camera again
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="relative flex flex-1 flex-col items-center justify-center px-8">
            {/* Viewfinder: four soft corners; they tighten on a successful read (green stays reserved for money) */}
            <div aria-hidden className={cn("relative size-64 transition-transform duration-[var(--vx-dur-base)] ease-spring", found && "scale-95")}>
              {CORNERS.map((c) => (
                <span key={c} className={cn("absolute size-14 transition-colors duration-[var(--vx-dur-fast)]", found ? "border-primary" : "border-white/80", c)} />
              ))}
              {cameraState === "starting" ? (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="size-8 animate-vx-spin rounded-full border-2 border-white/70 border-r-transparent" />
                </span>
              ) : null}
            </div>
            <p
              className={cn(
                "mt-8 max-w-[28ch] text-center text-body",
                error ? "rounded-md bg-surface/90 px-3 py-2 font-medium text-ink" : "text-white/85",
              )}
              role={error ? "alert" : "status"}
            >
              {cameraState === "starting" ? "Starting the camera…" : found ? "Got it" : (error ?? hint)}
            </p>
            {!error && !found && cameraState !== "starting" ? (
              <p className="mt-2 max-w-[30ch] text-center text-body-sm text-white/65">You&apos;ll check the amount before anything is paid.</p>
            ) : null}
          </div>
          <div className="relative px-5 pb-8">
            {showManual ? (
              <ManualPanel manual={manual} blocked={false} />
            ) : (
              <Button block variant="ghost" leadingIcon="link" className="text-white hover:bg-white/10" onClick={onEnterCode}>
                Type the code instead
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
