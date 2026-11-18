/**
 * Account + sign-in (D-104 wallet, D-802 session): the passkey-gated key signs the API's EIP-191 challenge, the API
 * returns a Bearer token. Display names are stored with the API user (shown to friends on recommendations).
 */
import type { Address } from "viem";
import { api } from "./api";
import { createWallet, deleteWallet, getSigner, loadWallet, lock, type StoredWallet } from "./wallet";
import { getSession, setSession } from "@/state/session";
import { notifyWalletChanged } from "@/state/wallet";

export async function signIn(opts: { displayName?: string; wallet?: StoredWallet } = {}): Promise<void> {
  const w = opts.wallet ?? (await loadWallet());
  if (!w) throw new Error("NO_WALLET");
  const signer = await getSigner();
  const ch = await api.challenge(signer.address);
  const signature = await signer.signMessage({ message: ch.message });
  const res = await api.verify({
    address: signer.address,
    challengeId: ch.challengeId,
    signature,
    displayName: opts.displayName ?? w.displayName ?? undefined,
    passkeyCredentialId: w.credentialId,
  });
  setSession({ token: res.token, expiresAt: res.expiresAt, address: signer.address, user: res.user });
}

export async function createAccount(displayName: string): Promise<StoredWallet> {
  const w = await createWallet(displayName.trim());
  notifyWalletChanged();
  await signIn({ displayName: displayName.trim(), wallet: w });
  return w;
}

/** A valid session for this device's account, signing in again (one Face ID) if the token is gone/expired. */
export async function ensureSession(): Promise<Address> {
  const w = await loadWallet();
  if (!w) throw new Error("NO_WALLET");
  const s = getSession();
  if (s && s.address.toLowerCase() === w.address.toLowerCase()) return w.address;
  await signIn({ wallet: w });
  return w.address;
}

export async function logout(): Promise<void> {
  try {
    if (getSession()) await api.logout();
  } catch {
    /* token may already be invalid */
  }
  setSession(null);
  lock();
}

/** Remove this device's account entirely (demo reset). The balance stays at the address; only this device forgets it. */
export async function forgetDevice(): Promise<void> {
  await logout();
  await deleteWallet();
  notifyWalletChanged();
}
