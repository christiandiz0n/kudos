"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

type Status =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "scanning" }
  | { kind: "unsupported"; reason: string }
  | { kind: "denied"; message: string }
  | { kind: "error"; message: string };

const MAX_DECODE_WIDTH = 640; // downscale frames before decoding (speed on low-end phones)
const DECODE_INTERVAL_MS = 120;

export default function Scanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastDecodeRef = useRef(0);

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [decoded, setDecoded] = useState<string | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [info, setInfo] = useState<string>("");

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  /** Decode one frame if enough time has passed since the last attempt. Uses only refs + state setters. */
  const decodeFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < video.HAVE_ENOUGH_DATA) return;
    const now = performance.now();
    if (now - lastDecodeRef.current < DECODE_INTERVAL_MS) return;
    lastDecodeRef.current = now;

    const scale = Math.min(1, MAX_DECODE_WIDTH / video.videoWidth);
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const t0 = performance.now();
    const code = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
    const ms = Math.round(performance.now() - t0);
    if (code?.data) {
      setDecoded(code.data);
      setScanCount((c) => c + 1);
      setInfo(`${video.videoWidth}x${video.videoHeight} -> ${w}x${h}, decode ${ms}ms`);
      navigator.vibrate?.(40);
    }
  }, []);

  const start = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!window.isSecureContext) {
      setStatus({ kind: "unsupported", reason: "Camera needs HTTPS (or localhost). Open this page over https://." });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus({ kind: "unsupported", reason: "This browser does not expose navigator.mediaDevices.getUserMedia." });
      return;
    }
    setStatus({ kind: "requesting" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("video element missing");
      video.srcObject = stream;
      await video.play();
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings();
      setInfo(`${track?.label ?? "camera"} · facing=${settings?.facingMode ?? "?"}`);
      setStatus({ kind: "scanning" });
      const loop = () => {
        decodeFrame();
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      stop();
      const e = err as DOMException;
      if (e?.name === "NotAllowedError" || e?.name === "SecurityError") {
        setStatus({
          kind: "denied",
          message: "Camera permission was denied. Allow camera access in your browser/site settings, then retry.",
        });
      } else if (e?.name === "NotFoundError" || e?.name === "OverconstrainedError") {
        setStatus({ kind: "error", message: "No usable camera found on this device." });
      } else if (e?.name === "NotReadableError") {
        setStatus({ kind: "error", message: "Camera is in use by another app. Close it and retry." });
      } else {
        setStatus({ kind: "error", message: `${e?.name ?? "Error"}: ${e?.message ?? String(err)}` });
      }
    }
  }, [stop, decodeFrame]);

  const scanning = status.kind === "scanning";

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted autoPlay />
        {!scanning && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-white/80">
            {status.kind === "requesting" ? "Waiting for camera permission…" : "Camera off"}
          </div>
        )}
        {scanning && (
          <div className="pointer-events-none absolute inset-[15%] rounded-xl border-4 border-white/70" aria-hidden />
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />

      {status.kind === "unsupported" && <Banner tone="warn">{status.reason}</Banner>}
      {status.kind === "denied" && <Banner tone="error">{status.message}</Banner>}
      {status.kind === "error" && <Banner tone="error">{status.message}</Banner>}

      {scanning ? (
        <button
          className="rounded-xl border border-zinc-400 px-4 py-3"
          onClick={() => {
            stop();
            setStatus({ kind: "idle" });
          }}
        >
          Stop camera
        </button>
      ) : (
        <button
          className="rounded-xl bg-foreground px-4 py-3 text-lg font-semibold text-background disabled:opacity-50"
          onClick={start}
          disabled={status.kind === "requesting"}
        >
          {status.kind === "idle" ? "Start camera" : "Retry"}
        </button>
      )}

      <section className="rounded-2xl border border-zinc-300 p-4">
        <div className="text-sm text-zinc-500">Decoded ({scanCount} reads)</div>
        <div className="mt-1 break-all text-3xl font-bold leading-tight" data-testid="decoded">
          {decoded ?? "—"}
        </div>
        {info && <div className="mt-2 text-xs text-zinc-500">{info}</div>}
      </section>
    </div>
  );
}

function Banner({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  const cls = tone === "warn" ? "border-amber-400 bg-amber-50 text-amber-900" : "border-red-400 bg-red-50 text-red-900";
  return (
    <div role="alert" className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>
      {children}
    </div>
  );
}
