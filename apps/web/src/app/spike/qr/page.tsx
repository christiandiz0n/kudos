import type { Metadata } from "next";
import { Suspense } from "react";
import QrRender from "./QrRender";

export const metadata: Metadata = { title: "S6 QR spike" };

export default function QrSpikePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-4 px-4 py-6">
      <h1 className="text-xl font-semibold">S6 spike — render a QR</h1>
      <Suspense fallback={<div className="text-zinc-500">Loading…</div>}>
        <QrRender />
      </Suspense>
    </main>
  );
}
