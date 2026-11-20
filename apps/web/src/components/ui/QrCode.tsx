import QRCode from "qrcode";

/**
 * Synchronous SVG QR (server- or client-rendered). Always dark-on-white with a quiet zone, even in
 * dark mode, so every phone camera reads it. Presentational: the payload comes from props.
 */
export function QrCode({ value, size = 240, label = "Payment code" }: { value: string; size?: number; label?: string }) {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const quiet = 2;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  const total = n + quiet * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
      className="block h-auto max-w-full rounded-sm bg-white"
    >
      <rect width={total} height={total} fill="#ffffff" />
      <path d={d} fill="#15202e" />
    </svg>
  );
}
