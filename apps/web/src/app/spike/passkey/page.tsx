import type { Metadata } from "next";
import PasskeyProbe from "./PasskeyProbe";

export const metadata: Metadata = { title: "S6b passkey spike" };

export default function PasskeySpikePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6">
      <h1 className="text-xl font-semibold">S6b spike — passkey + PRF support</h1>
      <p className="text-sm text-neutral-600">
        Creates a throwaway passkey for this test site, then asks for the PRF extension (used to
        derive the key that encrypts the in-browser wallet, D-104). Nothing leaves this page.
      </p>
      <PasskeyProbe />
    </main>
  );
}
