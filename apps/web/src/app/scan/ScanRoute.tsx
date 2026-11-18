"use client";

/** /scan — camera + jsQR (from the S6 spike), or paste a code/link. Opens /pay or /i/<code> on a match. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import jsQR from "jsqr";
import { ScanScreen, type CameraState } from "@/screens/customer/ScanScreen";
import { parseScan } from "@/lib/qr";

const MAX_DECODE_WIDTH = 640;
const DECODE_INTERVAL_MS = 120;

export function ScanRoute() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const doneRef = useRef(false);
  const [cameraState, setCameraState] = useState<CameraState>("starting");
  const [error, setError] = useState<string | undefined>();
  const [found, setFound] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [manualError, setManualError] = useState<string | undefined>();

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const go = useCallback(
    (raw: string): boolean => {
      const t = parseScan(raw);
      if (!t) return false;
      doneRef.current = true;
      setFound(true);
      navigator.vibrate?.(40);
      setTimeout(() => {
        stop();
        router.push(t.path);
      }, 400);
      return true;
    },
    [router, stop],
  );

  const decode = useCallback(() => {
    const video = videoRef.current;
    if (!video || doneRef.current || video.readyState < video.HAVE_ENOUGH_DATA) return;
    const now = performance.now();
    if (now - lastRef.current < DECODE_INTERVAL_MS) return;
    lastRef.current = now;
    const canvas = (canvasRef.current ??= document.createElement("canvas"));
    const scale = Math.min(1, MAX_DECODE_WIDTH / video.videoWidth);
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
    if (code?.data && !go(code.data)) setError("That code isn't for Vouch. Try the one on the counter screen.");
  }, [go]);

  const start = useCallback(async () => {
    setError(undefined);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraState("unavailable");
      return;
    }
    setCameraState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setCameraState("live");
      const loop = () => {
        decode();
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      stop();
      const name = (e as DOMException)?.name;
      setCameraState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
    }
  }, [decode, stop]);

  useEffect(() => {
    const t = setTimeout(() => void start(), 0);
    return () => {
      clearTimeout(t);
      stop();
    };
  }, [start, stop]);

  return (
    <div className="flex h-dvh flex-col">
      <ScanScreen
        camera={<video ref={videoRef} className="size-full object-cover" playsInline muted autoPlay />}
        cameraState={cameraState}
        error={error}
        found={found}
        manualOpen={manualOpen}
        manual={{
          value: manualValue,
          onChange: (v) => {
            setManualValue(v);
            setManualError(undefined);
          },
          onSubmit: () => {
            if (!go(manualValue)) setManualError("That doesn't look like a Vouch code or link.");
          },
          error: manualError,
        }}
        onClose={() => {
          stop();
          router.push("/wallet");
        }}
        onEnterCode={() => setManualOpen(true)}
        onRetryCamera={() => void start()}
      />
    </div>
  );
}
