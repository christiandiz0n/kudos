/**
 * Signing helpers for the typed data the API prepares (INTERFACES §5: uint fields arrive as DECIMAL STRINGS and must
 * become BigInt before signing). Mirrors `signTd` in apps/api/src/test/helpers.ts, but converts nested structs and
 * arrays too, and normalizes the domain.
 */
import type { Address, Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { ARC_TESTNET_CHAIN_ID, ARC_TESTNET_USDC_ADDRESS, VOUCH_ARC_TESTNET, paymentAuthNonce, type PaymentAuth } from "@vouch/shared";

export interface TypedField {
  name: string;
  type: string;
}
export interface TypedDataJson {
  domain: Record<string, unknown>;
  types: Record<string, TypedField[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

const INT_RE = /^u?int\d*$/;

function convertValue(types: Record<string, TypedField[]>, type: string, value: unknown): unknown {
  if (type.endsWith("]")) {
    const inner = type.slice(0, type.lastIndexOf("["));
    return (value as unknown[]).map((v) => convertValue(types, inner, v));
  }
  if (INT_RE.test(type)) return BigInt(value as string | number | bigint);
  if (types[type]) return convertStruct(types, type, value as Record<string, unknown>);
  return value;
}
function convertStruct(types: Record<string, TypedField[]>, type: string, value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...value };
  for (const f of types[type] ?? []) if (f.name in value) out[f.name] = convertValue(types, f.type, value[f.name]);
  return out;
}

/** JSON typed data → viem signTypedData params (BigInt uints, numeric chainId, no EIP712Domain entry). */
export function toViemTypedData(td: TypedDataJson) {
  const types = { ...td.types };
  delete types.EIP712Domain;
  const domain: Record<string, unknown> = { ...td.domain };
  if (domain.chainId !== undefined) domain.chainId = Number(domain.chainId);
  return { domain, types, primaryType: td.primaryType, message: convertStruct(types, td.primaryType, td.message) };
}

export async function signTypedDataJson(account: PrivateKeyAccount, td: TypedDataJson): Promise<Hex> {
  const p = toViemTypedData(td);
  return account.signTypedData(p as Parameters<PrivateKeyAccount["signTypedData"]>[0]);
}

export class UnsafeSignatureError extends Error {
  constructor(reason: string) {
    super(`Refusing to sign this payment: ${reason}`);
    this.name = "UnsafeSignatureError";
  }
}

const ZERO = "0x0000000000000000000000000000000000000000";
const eq = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase();

/**
 * Client-side guard before the ONE payment signature (MSG-011/041/057, D-014): the USDC ReceiveWithAuthorization must
 * pull exactly `amount` from me into the Vouch contract, its nonce must commit to the quoted PaymentAuth, and the
 * PaymentAuth.submitter must be the RELAYER (never 0, never anyone else). We sign what the API returns; we never
 * rebuild it, we only check it.
 */
export function assertSafePaymentTypedData(opts: {
  td: TypedDataJson;
  paymentAuth: Record<string, unknown>;
  me: Address;
  relayer: Address | null;
  expectedVenue: Address;
  expectedOrderId: Hex;
}): void {
  const { td, paymentAuth: pa, me } = opts;
  const m = td.message;
  if (td.primaryType !== "ReceiveWithAuthorization") throw new UnsafeSignatureError("unexpected message type");
  if (Number(td.domain.chainId) !== ARC_TESTNET_CHAIN_ID || !eq(td.domain.verifyingContract, ARC_TESTNET_USDC_ADDRESS)) throw new UnsafeSignatureError("wrong token domain");
  if (!eq(m.from, me) || !eq(pa.customer, me)) throw new UnsafeSignatureError("payer is not you");
  if (!eq(m.to, VOUCH_ARC_TESTNET.address)) throw new UnsafeSignatureError("payee is not the Vouch contract");
  if (String(m.value) !== String(pa.amount)) throw new UnsafeSignatureError("amount mismatch");
  if (!eq(pa.venue, opts.expectedVenue) || !eq(pa.orderId, opts.expectedOrderId)) throw new UnsafeSignatureError("order mismatch");
  if (!pa.submitter || eq(pa.submitter, ZERO)) throw new UnsafeSignatureError("open submitter");
  if (opts.relayer && !eq(pa.submitter, opts.relayer)) throw new UnsafeSignatureError("submitter is not the relayer");
  if (eq(pa.submitter, me)) throw new UnsafeSignatureError("self-submit is demo-only");
  const nonce = paymentAuthNonce({
    customer: pa.customer as Address,
    venue: pa.venue as Address,
    orderId: pa.orderId as Hex,
    amount: BigInt(pa.amount as string),
    weightsHash: pa.weightsHash as Hex,
    deadline: BigInt(pa.deadline as string),
    submitter: pa.submitter as Address,
  } as PaymentAuth);
  if (!eq(nonce, m.nonce)) throw new UnsafeSignatureError("authorization does not match the quote");
}
