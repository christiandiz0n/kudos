/**
 * Passkey-gated local wallet (D-104).
 *
 * A browser-generated secp256k1 key is encrypted at rest with AES-GCM and stored in IndexedDB. The AES key is:
 *  - "prf":    derived (HKDF-SHA256) from the WebAuthn PRF output of the user's passkey. Without a Face ID /
 *              fingerprint gesture the key cannot be decrypted at all.
 *  - "gated":  a NON-EXTRACTABLE WebCrypto AES key kept in IndexedDB; every unlock first requires a successful passkey
 *              assertion (user verification). This is UX gating, not cryptographic binding (documented in D-104).
 *  - "device": no WebAuthn in this browser at all (rare; e.g. some embedded webviews). Non-extractable key, no
 *              gesture. Labelled in the Details drawer only. Never chosen when a passkey is possible.
 *
 * The decrypted key lives only in this module's memory, for a short time (UNLOCK_TTL_MS), and is never persisted,
 * logged or sent anywhere. Payments always ask for a fresh gesture (`fresh: true`).
 */
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

export type WalletMode = "prf" | "gated" | "device";

export interface StoredWallet {
  v: 1;
  address: Address;
  mode: WalletMode;
  /** base64url WebAuthn credential id (prf / gated). */
  credentialId?: string;
  /** base64url PRF salt (prf). */
  prfSalt?: string;
  iv: string;
  ciphertext: string;
  /** Non-extractable AES-GCM key (gated / device). Structured-cloned by IndexedDB; can't be exported. */
  wrapKey?: CryptoKey;
  displayName: string;
  createdAt: number;
}

export class WalletError extends Error {
  constructor(
    public code: "NO_WALLET" | "CANCELLED" | "NOT_SUPPORTED" | "DECRYPT_FAILED" | "PRF_MISSING",
    message: string,
  ) {
    super(message);
    this.name = "WalletError";
  }
}

const DB_NAME = "vouch-wallet";
const STORE = "wallets";
const KEY = "current";
const HKDF_INFO = new TextEncoder().encode("vouch-wallet-v1/aes-gcm");
const UNLOCK_TTL_MS = 5 * 60_000;

// ------------------------------------------------------------------------------------------------ encoding
function b64u(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function random(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));
}

// ------------------------------------------------------------------------------------------------ IndexedDB
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function loadWallet(): Promise<StoredWallet | null> {
  if (typeof indexedDB === "undefined") return null;
  return (await idb<StoredWallet | undefined>("readonly", (s) => s.get(KEY))) ?? null;
}
async function saveWallet(w: StoredWallet): Promise<void> {
  await idb("readwrite", (s) => s.put(w, KEY));
}
/** Forget this device's account (only reachable from a Details/debug action; the money stays at the address). */
export async function deleteWallet(): Promise<void> {
  lock();
  await idb("readwrite", (s) => s.delete(KEY));
}

// ------------------------------------------------------------------------------------------------ crypto
async function aesFromPrf(prf: ArrayBuffer): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", prf, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: HKDF_INFO },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function encrypt(key: CryptoKey, pk: Hex): Promise<{ iv: string; ciphertext: string }> {
  const iv = random(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(pk));
  return { iv: b64u(iv), ciphertext: b64u(ct) };
}
async function decrypt(key: CryptoKey, w: StoredWallet): Promise<Hex> {
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(w.iv) }, key, unb64u(w.ciphertext));
    return new TextDecoder().decode(pt) as Hex;
  } catch {
    throw new WalletError("DECRYPT_FAILED", "We couldn't open your account on this device.");
  }
}

// ------------------------------------------------------------------------------------------------ WebAuthn
export async function passkeySupport(): Promise<{ webauthn: boolean; platform: boolean }> {
  if (typeof window === "undefined" || !window.PublicKeyCredential || !window.isSecureContext) return { webauthn: false, platform: false };
  let platform = false;
  try {
    platform = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    /* ignore */
  }
  return { webauthn: true, platform };
}

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };

function mapWebAuthnError(e: unknown): never {
  const name = (e as DOMException)?.name;
  if (name === "NotAllowedError" || name === "AbortError") throw new WalletError("CANCELLED", "Face ID or fingerprint was cancelled. Try again.");
  if (name === "NotSupportedError" || name === "SecurityError") throw new WalletError("NOT_SUPPORTED", "This browser can't use Face ID or fingerprint here.");
  throw e;
}

async function assertPasskey(w: StoredWallet): Promise<ArrayBuffer | null> {
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.get({
      publicKey: {
        challenge: random(32),
        allowCredentials: [{ type: "public-key", id: unb64u(w.credentialId!) }],
        userVerification: "required",
        timeout: 120_000,
        ...(w.mode === "prf" ? { extensions: { prf: { eval: { first: unb64u(w.prfSalt!) } } } as AuthenticationExtensionsClientInputs } : {}),
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    mapWebAuthnError(e);
  }
  if (!cred) throw new WalletError("CANCELLED", "Face ID or fingerprint was cancelled. Try again.");
  const ext = cred.getClientExtensionResults() as PrfResults;
  return ext.prf?.results?.first ?? null;
}

// ------------------------------------------------------------------------------------------------ public API
let unlocked: { account: PrivateKeyAccount; at: number } | null = null;

export function lock(): void {
  unlocked = null;
}

/**
 * Create a new account on this device. Prompts for Face ID / fingerprint once (twice on platforms that only return
 * the PRF secret on an assertion). Returns the new address; the key stays unlocked for UNLOCK_TTL_MS.
 */
export async function createWallet(displayName: string): Promise<StoredWallet> {
  const support = await passkeySupport();
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  const base = { v: 1 as const, address: account.address, displayName, createdAt: Date.now() };
  let stored: StoredWallet;

  if (support.webauthn) {
    const prfSalt = random(32);
    let cred: PublicKeyCredential | null;
    try {
      cred = (await navigator.credentials.create({
        publicKey: {
          rp: { name: "Kudos" },
          user: { id: random(16), name: displayName || "Kudos", displayName: displayName || "Kudos" },
          challenge: random(32),
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 },
          ],
          authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
          timeout: 120_000,
          extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
        },
      })) as PublicKeyCredential | null;
    } catch (e) {
      mapWebAuthnError(e);
    }
    if (!cred) throw new WalletError("CANCELLED", "Face ID or fingerprint was cancelled. Try again.");
    const credentialId = b64u(cred.rawId);
    const ext = cred.getClientExtensionResults() as PrfResults;
    let prf = ext.prf?.results?.first ?? null;
    if (!prf && ext.prf?.enabled) {
      // Many platforms (iOS, Android) only return the PRF output on get(): one more gesture.
      prf = await assertPasskey({ ...base, mode: "prf", credentialId, prfSalt: b64u(prfSalt), iv: "", ciphertext: "" });
    }
    if (prf) {
      const key = await aesFromPrf(prf);
      stored = { ...base, mode: "prf", credentialId, prfSalt: b64u(prfSalt), ...(await encrypt(key, pk)) };
    } else {
      const wrapKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      stored = { ...base, mode: "gated", credentialId, wrapKey, ...(await encrypt(wrapKey, pk)) };
    }
  } else {
    const wrapKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    stored = { ...base, mode: "device", wrapKey, ...(await encrypt(wrapKey, pk)) };
  }
  await saveWallet(stored);
  unlocked = { account, at: Date.now() };
  return stored;
}

/**
 * Get a signer. Re-uses a recent unlock unless `fresh` (payments always pass fresh: one Face ID per payment).
 */
export async function getSigner(opts: { fresh?: boolean } = {}): Promise<PrivateKeyAccount> {
  const w = await loadWallet();
  if (!w) throw new WalletError("NO_WALLET", "There's no account on this device yet.");
  if (unlocked && unlocked.account.address === w.address && !opts.fresh && Date.now() - unlocked.at < UNLOCK_TTL_MS) {
    return unlocked.account;
  }
  let key: CryptoKey;
  if (w.mode === "prf") {
    const prf = await assertPasskey(w);
    if (!prf) throw new WalletError("PRF_MISSING", "Face ID or fingerprint didn't unlock your account. Try again.");
    key = await aesFromPrf(prf);
  } else if (w.mode === "gated") {
    await assertPasskey(w);
    key = w.wrapKey!;
  } else {
    key = w.wrapKey!;
  }
  const account = privateKeyToAccount(await decrypt(key, w));
  if (account.address !== w.address) throw new WalletError("DECRYPT_FAILED", "We couldn't open your account on this device.");
  unlocked = { account, at: Date.now() };
  return account;
}

export function isUnlocked(address?: string): boolean {
  return !!unlocked && Date.now() - unlocked.at < UNLOCK_TTL_MS && (!address || unlocked.account.address.toLowerCase() === address.toLowerCase());
}
