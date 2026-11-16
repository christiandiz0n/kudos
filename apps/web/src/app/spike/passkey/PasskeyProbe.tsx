"use client";

// S6b spike: does this phone/browser support passkeys + the WebAuthn PRF extension?
// PRF lets us derive a stable 32-byte secret from a passkey gesture to encrypt the local
// wallet key (D-104). Without PRF we fall back to a passkey-gated, non-extractable WebCrypto key.
import { useState } from "react";

type Line = { ok: boolean | null; text: string };

const SALT = new TextEncoder().encode("wom-s6b-prf-salt-v1");

function toHex(buf: ArrayBuffer) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function PasskeyProbe() {
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const log = (ok: boolean | null, text: string) => setLines((l) => [...l, { ok, text }]);

  async function run() {
    setLines([]);
    setBusy(true);
    try {
      log(null, `UA: ${navigator.userAgent}`);
      log(!!window.isSecureContext, `Secure context (HTTPS): ${window.isSecureContext}`);
      if (!window.PublicKeyCredential) {
        log(false, "WebAuthn not available in this browser");
        return;
      }
      const uvpa = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      log(uvpa, `Platform authenticator (Face ID / fingerprint) available: ${uvpa}`);

      // Optional capability probe (Chrome/Safari 2024+)
      const pkc = PublicKeyCredential as unknown as {
        getClientCapabilities?: () => Promise<Record<string, boolean>>;
      };
      if (pkc.getClientCapabilities) {
        const caps = await pkc.getClientCapabilities();
        log(caps["extension:prf"] ?? null, `getClientCapabilities extension:prf = ${caps["extension:prf"]}`);
      }

      const userId = crypto.getRandomValues(new Uint8Array(16));
      const cred = (await navigator.credentials.create({
        publicKey: {
          rp: { name: "wom spike" },
          user: { id: userId, name: `spike-${Date.now()}`, displayName: "S6b spike" },
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 },
          ],
          authenticatorSelection: { residentKey: "required", userVerification: "required" },
          extensions: { prf: { eval: { first: SALT } } } as AuthenticationExtensionsClientInputs,
        },
      })) as PublicKeyCredential | null;
      if (!cred) {
        log(false, "Passkey creation returned null");
        return;
      }
      log(true, "Passkey created ✔");
      const createExt = cred.getClientExtensionResults() as {
        prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
      };
      log(createExt.prf?.enabled ?? null, `PRF enabled at create: ${createExt.prf?.enabled}`);

      // Many platforms only return PRF output on get(), so assert with the new credential.
      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [{ type: "public-key", id: cred.rawId }],
          userVerification: "required",
          extensions: { prf: { eval: { first: SALT } } } as AuthenticationExtensionsClientInputs,
        },
      })) as PublicKeyCredential | null;
      const getExt = assertion?.getClientExtensionResults() as
        | { prf?: { results?: { first?: ArrayBuffer } } }
        | undefined;
      const first = getExt?.prf?.results?.first ?? createExt.prf?.results?.first;
      if (first) {
        log(true, `PRF output received (${first.byteLength} bytes): ${toHex(first).slice(0, 16)}… → RESULT: PRF SUPPORTED`);
      } else {
        log(false, "No PRF output → RESULT: PRF NOT SUPPORTED (we use the passkey-gated fallback)");
      }
    } catch (e) {
      const err = e as Error;
      log(false, `Error: ${err.name}: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={run}
        disabled={busy}
        className="rounded-xl bg-black px-4 py-3 text-base font-medium text-white disabled:opacity-50"
      >
        {busy ? "Testing…" : "Run passkey test"}
      </button>
      <ul className="flex flex-col gap-2 text-sm">
        {lines.map((l, i) => (
          <li key={i} className="break-words font-mono">
            {l.ok === null ? "•" : l.ok ? "✅" : "❌"} {l.text}
          </li>
        ))}
      </ul>
      <p className="text-xs text-neutral-500">
        Please screenshot this list and share it. You can delete the “wom spike” passkey from your
        password manager afterwards.
      </p>
    </div>
  );
}
