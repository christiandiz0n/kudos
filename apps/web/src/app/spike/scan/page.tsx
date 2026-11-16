import type { Metadata } from "next";
import Scanner from "./Scanner";

export const metadata: Metadata = { title: "S6 scan spike" };

export default function ScanSpikePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6">
      <h1 className="text-xl font-semibold">S6 spike — rear camera QR scan</h1>
      <Scanner />
    </main>
  );
}
