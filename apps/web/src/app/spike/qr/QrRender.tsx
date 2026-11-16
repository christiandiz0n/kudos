"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";

/** /spike/qr?text=... renders `text` as a QR (default: a sample order payload ~ the size of a signed Order). */
export default function QrRender() {
  const params = useSearchParams();
  const text =
    params.get("text") ??
    "vouch:order?venue=0x0000000000000000000000000000000000000001&orderId=0x01&amount=12000000&exp=1800000000&sig=0x" +
      "ab".repeat(65);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(text, { errorCorrectionLevel: "M", margin: 2, width: 720 })
      .then((url) => !cancelled && (setDataUrl(url), setError(null)))
      .catch((e: unknown) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [text]);

  return (
    <div className="flex w-full flex-col items-center gap-3">
      {error && <div className="text-red-600">{error}</div>}
      {dataUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimize
        <img src={dataUrl} alt="QR code" className="aspect-square w-full max-w-sm bg-white" />
      )}
      <div className="w-full break-all rounded-xl border border-zinc-300 p-3 font-mono text-xs">{text}</div>
      <div className="text-xs text-zinc-500">{text.length} chars · scan with /spike/scan on a phone</div>
    </div>
  );
}
